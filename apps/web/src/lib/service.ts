import { market } from './providers/registry';
import { fmpExtras } from '@/lib/providers/equity/fmp';
import { finnhubExtras } from '@/lib/providers/equity/finnhub';
import { defillama } from '@/lib/providers/crypto/defillama';
import { cached, cacheKey, TTL } from './cache';
import { scoreAsset, InsufficientDataError } from './analysis/engine';
import type { AssetContext, AssetScore } from './analysis/types';
import type { AssetRef, Quote, ProviderResult } from './providers/types';
import { log } from './logger';

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

  const [quote, ohlcv, fundamentals, cryptoMetrics, news] = await Promise.all([
    market.quote(ref.symbol, ref.kind),
    market.ohlcv(ref.symbol, '1d', 260),
    isCrypto
      ? Promise.resolve({ ok: false, reason: 'not_supported' } as const)
      : market.fundamentals(ref.symbol),
    isCrypto
      ? market.cryptoMetrics(ref.symbol)
      : Promise.resolve({ ok: false, reason: 'not_supported' } as const),
    market.news(ref.symbol, 25),
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
