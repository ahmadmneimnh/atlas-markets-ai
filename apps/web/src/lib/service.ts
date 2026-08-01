import { market } from './providers/registry';
import { fmpExtras } from '@/lib/providers/equity/fmp';
import { finnhubExtras } from '@/lib/providers/equity/finnhub';
import { defillama } from '@/lib/providers/crypto/defillama';
import { cached, cacheKey, TTL } from './cache';
import { scoreAsset, InsufficientDataError } from './analysis/engine';
import {
  INSUFFICIENT_DATA_MESSAGE,
  buildTradePlan,
  type PlanOutcome,
  type TradePlan,
} from './analysis/decision';
import type { AssetContext, AssetScore } from './analysis/types';
import type { AssetRef, Quote, ProviderResult } from './providers/types';
import { log } from './logger';
import { configuredProviders } from '@/lib/env';
import { CRYPTO_UNIVERSE, UNIVERSE } from '@/lib/universe';
import { scan, type ScannerInput, type ScannerResult } from '@/lib/scanner/rank';

/**
 * Application service: assembles an AssetContext from the provider registry and
 * runs the scoring engine.
 *
 * All provider calls fan out concurrently — they are independent, and doing them
 * serially would make a single asset page wait on the sum of five round trips.
 */

export interface ScoreOutcome {
  ok: true;
  score: AssetScore;
  quote?: Quote;
  /**
   * Entry, target and stop for this score.
   *
   * Computed here, where the context is already in hand, rather than by a second
   * pass: the scanner needs a target to show upside on a card, the detail page
   * needs the full plan, and deriving it twice from two contexts is how the card
   * and the page end up quoting different targets for the same asset.
   */
  plan?: TradePlan;
}

export interface ScoreFailure {
  ok: false;
  /** Why no recommendation could be produced. Shown to the user verbatim. */
  message: string;
  /** Per-factor omission reasons, when the engine ran but lacked coverage. */
  omitted?: { factor: string; reason: string }[];
}

export async function buildContext(ref: AssetRef): Promise<AssetContext> {
  const isCrypto = ref.kind === 'crypto';

  const [quote, ohlcv, fundamentals, cryptoMetrics, news, analyst] = await Promise.all([
    market.quote(ref.symbol, ref.kind),
    market.ohlcv(ref.symbol, '1d', 260),
    isCrypto
      ? Promise.resolve({ ok: false, reason: 'not_supported' } as const)
      : market.fundamentals(ref.symbol),
    isCrypto
      ? market.cryptoMetrics(ref.symbol)
      : Promise.resolve({ ok: false, reason: 'not_supported' } as const),
    market.news(ref.symbol, 25),
    // Sell-side estimates feed both the fundamental factor and the target
    // selection in the decision module, so they belong in the shared context
    // rather than being fetched separately by each. Cached for a day at the
    // registry, which is what makes it affordable across a whole-universe scan.
    isCrypto
      ? Promise.resolve({ ok: false, reason: 'not_supported' } as const)
      : market.analystEstimates(ref.symbol),
  ]);

  const unwrap = <T>(r: ProviderResult<T> | { ok: false; reason: string }): T | undefined =>
    r.ok ? (r as { ok: true; data: T }).data : undefined;

  const ctx: AssetContext = { ref };
  const q = unwrap(quote);
  const o = unwrap(ohlcv);
  const f = unwrap(fundamentals);
  const m = unwrap(cryptoMetrics);
  const n = unwrap(news);

  if (q) ctx.quote = q;
  if (o) ctx.ohlcv = o;
  if (f) ctx.fundamentals = f;
  if (m) ctx.cryptoMetrics = m;
  if (n) ctx.news = n;

  const est = unwrap(analyst);
  if (est) ctx.analyst = est;

  return ctx;
}

export async function getScore(ref: AssetRef): Promise<ScoreOutcome | ScoreFailure> {
  return cached(
    cacheKey('score', ref.kind, ref.symbol),
    TTL.score,
    async () => {
      const ctx = await buildContext(ref);
      try {
        const score = await scoreAsset(ctx);
        const out: ScoreOutcome = { ok: true, score };
        if (ctx.quote) out.quote = ctx.quote;
        const plan = buildTradePlan(ctx, score);
        if (plan.ok) out.plan = plan.plan;
        return out;
      } catch (err) {
        if (err instanceof InsufficientDataError) {
          log.info('score_insufficient_data', { symbol: ref.symbol, coverage: err.coverage });
          return {
            ok: false,
            message: err.message,
            omitted: err.omitted,
          } satisfies ScoreFailure;
        }
        log.error('score_failed', {
          symbol: ref.symbol,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'Scoring failed',
        } satisfies ScoreFailure;
      }
    },
    // Never cache a failure for the full score TTL — the underlying provider may
    // recover within seconds.
    (v) => (v.ok ? TTL.score : TTL.failure),
  );
}

/**
 * Scores a batch of assets, tolerating individual failures.
 *
 * Concurrency is capped: firing 50 assets at once would breach every provider's
 * rate limit simultaneously and trip the circuit breakers, turning a slow page
 * into a broken one.
 */
export async function scoreMany(
  refs: AssetRef[],
  concurrency = 4,
): Promise<{ ref: AssetRef; result: ScoreOutcome | ScoreFailure }[]> {
  const out: { ref: AssetRef; result: ScoreOutcome | ScoreFailure }[] = [];

  for (let i = 0; i < refs.length; i += concurrency) {
    const batch = refs.slice(i, i + concurrency);
    const settled = await Promise.all(
      batch.map(async (ref) => ({ ref, result: await getScore(ref) })),
    );
    out.push(...settled);
  }
  return out;
}

export type { PlanOutcome, TradePlan } from './analysis/decision';

/**
 * The investment decision: entry, target and stop for one asset.
 *
 * A read of the plan `getScore` already computed, not a second derivation. The
 * plan is built inside the scoring pass because that is where the assembled
 * context lives, and because the scanner needs the same target to show upside on
 * a card. Recomputing it here from a freshly-built context would be both a
 * duplicate pass and a correctness hazard: the two contexts can straddle a cache
 * expiry, and the card and the detail page would then quote different targets
 * for the same asset within the same minute.
 *
 * A score that exists but yielded no plan is reported with the reasons the
 * decision module gave, rather than as a generic failure.
 */
export async function getPlan(ref: AssetRef): Promise<PlanOutcome> {
  const outcome = await getScore(ref);

  if (!outcome.ok) {
    return { ok: false, message: INSUFFICIENT_DATA_MESSAGE, missing: [outcome.message] };
  }

  if (outcome.plan) return { ok: true, plan: outcome.plan };

  // The score succeeded but the levels did not. Re-deriving against the cached
  // context is cheap (every provider call inside it is a cache read) and gives
  // the reader the specific missing input instead of "unavailable".
  const ctx = await buildContext(ref);
  return buildTradePlan(ctx, outcome.score);
}

/**
 * Detail-page data that is not a routed capability.
 *
 * Financial statements, insider filings, ownership and TVL each have exactly one
 * possible provider, so they are not worth a `Capability` — a fallthrough list of
 * length one is a function call wearing a costume.
 *
 * They are re-exported through the service layer rather than imported directly by
 * pages, because the layering rule (`no-restricted-imports` in eslint.config.mjs)
 * is what keeps adapter modules — and the API keys they read — out of anything
 * that could become a client component. The rule caught this exact import when
 * the detail page first reached for the adapters, which is the rule working.
 */
// Result types re-exported alongside the functions, so a component never needs
// to name an adapter module even for a type-only import. `import type` is erased
// at compile time and is genuinely safe, but the lint rule cannot tell the two
// apart — and a rule with a per-file exception is a rule people learn to bypass.
export type {
  FmpBalanceSheet,
  FmpCashFlow,
  FmpIncomeStatement,
  FmpPriceTarget,
  FmpAnalystRating,
} from '@/lib/providers/equity/fmp';
export type { InsiderTransaction, InstitutionalHolder } from '@/lib/providers/equity/finnhub';
export type { ChainTvl } from '@/lib/providers/crypto/defillama';

export const detail = {
  incomeStatement: (symbol: string, periods = 5) => fmpExtras.incomeStatement(symbol, periods),
  balanceSheet: (symbol: string, periods = 5) => fmpExtras.balanceSheet(symbol, periods),
  cashFlow: (symbol: string, periods = 5) => fmpExtras.cashFlow(symbol, periods),
  priceTarget: (symbol: string) => fmpExtras.priceTarget(symbol),
  analystRatings: (symbol: string) => fmpExtras.analystRatings(symbol),
  insiderTransactions: (symbol: string) => finnhubExtras.insiderTransactions(symbol),
  institutionalOwnership: (symbol: string) => finnhubExtras.institutionalOwnership(symbol),
  chainTvl: (symbol: string) => defillama.chainTvl(symbol),
};

/**
 * The market scanner.
 *
 * Scores the tracked universe and ranks it into buy / hold / sell lists. Sits in
 * the service layer so the homepage, the API route and any future consumer share
 * one implementation and one cache entry — scoring the universe is the most
 * expensive thing this application does, and doing it twice per page load would
 * be the easiest possible way to exhaust a provider quota.
 *
 * The cache TTL matches the score TTL: a scan is only as fresh as the scores it
 * ranks, and caching it for longer would report a stale ordering as current.
 */
/**
 * Which assets a scan covers.
 *
 * When no equity provider is configured the equity universe is dropped rather
 * than attempted: scoring thirty tickers that will all fail costs thirty round
 * trips to report one fact the registry already knows.
 */
function scanUniverse(kind: 'equity' | 'crypto' | 'all'): typeof UNIVERSE {
  const providers = configuredProviders();
  const hasEquityProvider = providers['finnhub'] || providers['twelvedata'] || providers['polygon'];

  const universe =
    kind === 'crypto'
      ? CRYPTO_UNIVERSE
      : kind === 'equity'
        ? UNIVERSE.filter((entry) => entry.kind === 'equity')
        : UNIVERSE;

  return hasEquityProvider || kind === 'crypto' ? universe : CRYPTO_UNIVERSE;
}

/** The scan itself, without caching. Both the live and daily entry points use it. */
async function runScannerUncached(
  kind: 'equity' | 'crypto' | 'all',
  limit: number,
): Promise<ScannerResult> {
  const refs = scanUniverse(kind);
  const results = await scoreMany(refs, 4);

  const inputs: ScannerInput[] = results.flatMap((entry) => {
    if (!entry.result.ok) return [];
    const outcome = entry.result;
    const known = UNIVERSE.find((u) => u.symbol === entry.ref.symbol && u.kind === entry.ref.kind);
    const item: ScannerInput = { name: known?.name ?? entry.ref.symbol, score: outcome.score };
    if (outcome.quote) item.quote = outcome.quote;
    if (outcome.plan) item.plan = outcome.plan;
    return [item];
  });

  return scan(inputs, refs.length, limit);
}

export async function runScanner(
  kind: 'equity' | 'crypto' | 'all' = 'all',
  limit = 5,
): Promise<ScannerResult> {
  return cached(
    cacheKey('scanner', kind, limit),
    TTL.score,
    () => runScannerUncached(kind, limit),
    // A scan is cached for as long as the scores it ranks. There is no separate
    // failure TTL: `scan` always returns a result, reporting an empty list with
    // its coverage rather than throwing.
    () => TTL.score,
  );
}

/**
 * The daily scan: every tracked stock and crypto, strongest buy to strongest sell.
 *
 * Distinct from `runScanner` in one way that matters, and it is not the size of
 * the list. This one is keyed by UTC date and held for the day, so the ranking a
 * reader saw at 09:00 is the ranking they see at 15:00.
 *
 * That is the point of a *daily* scanner rather than a live one. A ranking that
 * silently reshuffles every five minutes cannot be worked through: an asset
 * studied at position 4 has moved to position 11 by the time its neighbour is
 * read, and there is no way to tell whether that reflects real news or a quote
 * that ticked. The homepage keeps the live view, where freshness is the whole
 * point; this is the stable one.
 *
 * The cost is stated rather than hidden — the page shows the timestamp the scan
 * was computed at, so nobody reads a five-hour-old price as current.
 */
export async function runDailyScan(kind: 'equity' | 'crypto' | 'all' = 'all'): Promise<{
  result: ScannerResult;
  /** UTC date the ranking belongs to, as YYYY-MM-DD. */
  scanDate: string;
}> {
  const scanDate = new Date().toISOString().slice(0, 10);

  const result = await cached(
    cacheKey('scanner-daily', scanDate, kind),
    // A day, minus a margin: expiring exactly at midnight would leave the first
    // request of the new day racing the expiry of the old one.
    23 * 60 * 60,
    // Ranking the whole universe means no per-band truncation, so the limit is
    // the universe size rather than the homepage's five.
    async () => runScannerUncached(kind, UNIVERSE.length),
    () => 23 * 60 * 60,
  );

  return { result, scanDate };
}
