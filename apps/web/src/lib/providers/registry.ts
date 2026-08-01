import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { cached, cacheKey, resultTtl, TTL } from '@/lib/cache';
import type {
  Provider,
  AssetKind,
  Capability,
  ProviderResult,
  Quote,
  OhlcvSeries,
  Fundamentals,
  CompanyProfile,
  NewsArticle,
  CryptoMetrics,
  Filing,
  AnalystEstimates,
  SearchHit,
  Unavailable,
  EarningsEvent,
  EconomicEvent,
  FearGreed,
} from './types';
import { unavailable } from './types';

import { finnhub } from './equity/finnhub';
import { alphavantage } from './equity/alphavantage';
import { polygon } from './equity/polygon';
import { twelvedata } from './equity/twelvedata';
import { fmp } from './equity/fmp';
import { yahoo } from './equity/yahoo';
import { sec } from './equity/sec';
import { stooq } from './equity/stooq';
import { coingecko } from './crypto/coingecko';
import { binance } from './crypto/binance';
import { coinmarketcap } from './crypto/coinmarketcap';
import { coinbase } from './crypto/coinbase';
import { alternativeme } from './sentiment/alternativeme';
import { newsapi } from './news/newsapi';

/**
 * Capability-routed provider registry.
 *
 * Call sites ask for a capability ("give me a quote"), never for a vendor. The
 * registry picks among configured providers by priority and falls through on
 * failure. Adding or swapping a vendor therefore touches this file's ALL list and
 * nothing else in the application.
 */

const ALL: Provider[] = [
  finnhub,
  polygon,
  twelvedata,
  fmp,
  alphavantage,
  yahoo,
  binance,
  coinbase,
  coingecko,
  coinmarketcap,
  alternativeme,
  newsapi,
  sec,
  stooq,
];

/**
 * Default ordering per capability, best-first. Overridable per deployment via
 * ATLAS_PRIORITY_* env vars — that override is the documented swap mechanism.
 */
/**
 * Ordering rationale, since "best-first" is doing real work here:
 *
 *  - **Finnhub leads the equity capabilities.** 60 req/min on the free tier is an
 *    order of magnitude more headroom than Polygon's 5 or Alpha Vantage's 25/day.
 *  - **Yahoo is last everywhere it appears.** It is an undocumented endpoint with
 *    no contract and no support (see its adapter); a useful gap-filler, never the
 *    primary source for a number a user acts on.
 *  - **Alpha Vantage is deliberately near-last for OHLCV.** 25 requests per *day*
 *    means putting it earlier would exhaust it during a single screener load and
 *    leave nothing for the case it exists to cover.
 *  - **Stooq sits just above Yahoo for OHLCV.** It is the only equity price
 *    history in this list that needs no credential, which makes it the
 *    difference between a Finnhub-only deployment scoring 45% of the weight with
 *    no price levels at all, and scoring the full set. It is below the keyed
 *    vendors because it serves daily bars only and publishes no uptime promise.
 *  - **Binance leads crypto prices and bars; CoinGecko leads crypto metrics.**
 *    Binance has the deeper book on most pairs, and — the part that is not
 *    cosmetic — its klines carry real volume, while CoinGecko's `/ohlc` returns
 *    [time, o, h, l, c] with none. Promoting CoinGecko for bars would silently
 *    switch off the two indicators that need volume (VWAP and the
 *    volume-vs-average trend) and lower the technical factor's confidence on
 *    every token. CoinGecko still owns `crypto.metrics`, where it is the only
 *    source for market cap, supply and rank. Coinbase sits second on quotes: it
 *    prices in real USD rather than USDT, so it is the better answer whenever
 *    the peg is under stress — exactly when the fallthrough gets exercised.
 */
const DEFAULT_ORDER: Partial<Record<Capability, string[]>> = {
  quote: ['finnhub', 'twelvedata', 'fmp', 'polygon', 'yahoo'],
  ohlcv: [
    'binance',
    'coinbase',
    'twelvedata',
    'polygon',
    'alphavantage',
    'coingecko',
    'stooq',
    'yahoo',
  ],
  fundamentals: ['fmp', 'finnhub', 'alphavantage'],
  profile: ['finnhub', 'fmp', 'polygon'],
  // NewsAPI last: the others return vendor-tagged company news, while NewsAPI
  // returns keyword hits. See its adapter for why that ordering is not cosmetic.
  news: ['finnhub', 'fmp', 'newsapi'],
  'crypto.quote': ['binance', 'coinbase', 'coingecko', 'coinmarketcap'],
  'crypto.metrics': ['coingecko', 'coinmarketcap'],
  search: ['finnhub', 'twelvedata', 'coingecko', 'coinmarketcap', 'polygon', 'yahoo'],
  earnings: ['finnhub'],
  'economic.calendar': ['finnhub'],
  'fear.greed': ['alternativeme'],
  filings: ['sec'],
  analyst: ['fmp'],
};

function envOverride(cap: Capability): string[] {
  switch (cap) {
    case 'quote':
      return env.priority.quote;
    case 'ohlcv':
      return env.priority.ohlcv;
    case 'fundamentals':
      return env.priority.fundamentals;
    case 'news':
      return env.priority.news;
    default:
      return [];
  }
}

/**
 * Providers implementing `cap`, split into those that can be called and those
 * that were skipped for want of credentials.
 *
 * The skipped list is returned rather than silently dropped, and that is not
 * bookkeeping. Filtering unconfigured providers out invisibly is what makes a
 * missing API key present as a vendor problem: the preferred provider vanishes
 * from consideration without comment, an unauthenticated fallback answers
 * instead, and the only thing reaching the logs is that fallback rate-limiting.
 * Naming the skipped provider turns a two-hour investigation into one log line.
 */
function candidates(
  cap: Capability,
  kind?: AssetKind,
): { usable: Provider[]; unconfigured: string[] } {
  const order = envOverride(cap).length > 0 ? envOverride(cap) : (DEFAULT_ORDER[cap] ?? []);
  const byId = new Map(ALL.map((p) => [p.id, p]));

  // Filtered only when a kind is supplied. `search` deliberately fans out across
  // both asset classes, and narrowing it here would drop the crypto results.
  const serves = (p: Provider): boolean =>
    kind === undefined || p.assetKinds === undefined || p.assetKinds.includes(kind);

  const ranked = order
    .map((id) => byId.get(id))
    .filter((p): p is Provider => Boolean(p) && p!.capabilities.includes(cap) && serves(p!));

  // Any provider supporting the capability but absent from the explicit order is
  // appended, so a newly added adapter is usable before anyone updates config.
  const extras = ALL.filter(
    (p) => p.capabilities.includes(cap) && serves(p) && !ranked.includes(p),
  );

  const all = [...ranked, ...extras];
  return {
    usable: all.filter((p) => p.isConfigured()),
    unconfigured: all.filter((p) => !p.isConfigured()).map((p) => p.id),
  };
}

/**
 * Tries each candidate in order, returning the first success.
 *
 * `not_found` short-circuits: if a provider affirmatively reports the symbol does
 * not exist, asking three more vendors the same question wastes quota on all of
 * them to reach the same answer.
 */
async function resolve<T>(
  cap: Capability,
  invoke: (p: Provider) => Promise<ProviderResult<T>> | undefined,
  kind?: AssetKind,
): Promise<ProviderResult<T>> {
  const { usable, unconfigured } = candidates(cap, kind);

  if (usable.length === 0) {
    // Naming the providers that *would* have served this is the difference
    // between "the feature is broken" and "set one of these keys".
    const detail =
      unconfigured.length > 0
        ? `no configured provider implements "${cap}" — ${unconfigured.join(', ')} ` +
          `${unconfigured.length === 1 ? 'implements' : 'implement'} it but ${unconfigured.length === 1 ? 'has' : 'have'} no credentials`
        : `no configured provider implements "${cap}"`;
    return { ...unavailable('no_provider_configured', detail), skipped: unconfigured };
  }

  const tried: string[] = [];
  let last: Unavailable = unavailable('upstream_error', 'no provider attempted');

  for (const p of usable) {
    const call = invoke(p);
    if (!call) continue;
    tried.push(p.id);

    const result = await call;
    if (result.ok) return result;

    last = result;
    if (result.reason === 'not_found') break;

    log.warn('provider_fallthrough', {
      capability: cap,
      provider: p.id,
      reason: result.reason,
      // Carried on the fallthrough itself: when the last usable provider fails,
      // this line is the one a reader sees, and it should already answer "why
      // was my preferred vendor not used".
      ...(unconfigured.length > 0 ? { unconfigured } : {}),
    });
  }

  return { ...last, tried, ...(unconfigured.length > 0 ? { skipped: unconfigured } : {}) };
}

// ── Public API ──────────────────────────────────────────────────────────────────

export const market = {
  async quote(symbol: string, kind: 'equity' | 'crypto'): Promise<ProviderResult<Quote>> {
    const cap: Capability = kind === 'crypto' ? 'crypto.quote' : 'quote';
    const ttl = kind === 'crypto' ? TTL.quoteCrypto : TTL.quoteEquity;

    return cached(
      cacheKey('quote', kind, symbol),
      ttl,
      () =>
        resolve<Quote>(cap, (p) =>
          kind === 'crypto' ? p.cryptoQuote?.(symbol) : p.quote?.(symbol),
        ),
      resultTtl(ttl),
    );
  },

  /**
   * `kind` is optional for backwards compatibility but should always be passed.
   * Without it the registry asks Binance for equity bars — a guaranteed failure
   * that also counts against Binance's circuit breaker, so a scan over equities
   * ends up disabling crypto pricing.
   */
  async ohlcv(
    symbol: string,
    interval: '1d' | '1h' | '1w' = '1d',
    limit = 260,
    kind?: AssetKind,
  ): Promise<ProviderResult<OhlcvSeries>> {
    return cached(
      cacheKey('ohlcv', symbol, interval, limit),
      TTL.ohlcvDaily,
      () => resolve<OhlcvSeries>('ohlcv', (p) => p.ohlcv?.(symbol, interval, limit), kind),
      resultTtl(TTL.ohlcvDaily),
    );
  },

  async fundamentals(symbol: string): Promise<ProviderResult<Fundamentals>> {
    return cached(
      cacheKey('fundamentals', symbol),
      TTL.fundamentals,
      () => resolve<Fundamentals>('fundamentals', (p) => p.fundamentals?.(symbol)),
      resultTtl(TTL.fundamentals),
    );
  },

  async profile(symbol: string): Promise<ProviderResult<CompanyProfile>> {
    return cached(
      cacheKey('profile', symbol),
      TTL.profile,
      () => resolve<CompanyProfile>('profile', (p) => p.profile?.(symbol)),
      resultTtl(TTL.profile),
    );
  },

  async news(symbol: string | null, limit = 20): Promise<ProviderResult<NewsArticle[]>> {
    return cached(
      cacheKey('news', symbol ?? 'market', limit),
      TTL.news,
      () => resolve<NewsArticle[]>('news', (p) => p.news?.(symbol, limit)),
      resultTtl(TTL.news),
    );
  },

  async cryptoMetrics(symbol: string): Promise<ProviderResult<CryptoMetrics>> {
    return cached(
      cacheKey('cryptometrics', symbol),
      TTL.fundamentals,
      () => resolve<CryptoMetrics>('crypto.metrics', (p) => p.cryptoMetrics?.(symbol)),
      resultTtl(TTL.fundamentals),
    );
  },

  async analystEstimates(symbol: string): Promise<ProviderResult<AnalystEstimates>> {
    return cached(
      cacheKey('analyst', symbol),
      // Deliberately the fundamentals TTL, not the score TTL. Sell-side targets
      // move when an analyst publishes, which is a handful of times a quarter —
      // and this now runs for every asset the scanner scores, so a short TTL
      // would spend a day's FMP quota on one page load.
      TTL.fundamentals,
      () => resolve<AnalystEstimates>('analyst', (p) => p.analystEstimates?.(symbol)),
      resultTtl(TTL.fundamentals),
    );
  },

  async filings(symbol: string, limit = 10): Promise<ProviderResult<Filing[]>> {
    return cached(
      cacheKey('filings', symbol, limit),
      // Filings are immutable once submitted and arrive a few times a quarter,
      // so this matches the fundamentals cadence rather than the quote cadence.
      TTL.fundamentals,
      () => resolve<Filing[]>('filings', (p) => p.filings?.(symbol, limit)),
      resultTtl(TTL.fundamentals),
    );
  },

  async search(query: string): Promise<ProviderResult<SearchHit[]>> {
    // Search fans out rather than falling through: equity and crypto results come
    // from different vendors and the user wants both in one list.
    const { usable, unconfigured } = candidates('search');
    if (usable.length === 0) {
      return {
        ...unavailable(
          'no_provider_configured',
          unconfigured.length > 0
            ? `no search provider configured — ${unconfigured.join(', ')} implement search but hold no credentials`
            : 'no search provider',
        ),
        skipped: unconfigured,
      };
    }

    const results = await Promise.all(
      usable.map((p) => p.search?.(query) ?? Promise.resolve(null)),
    );
    const hits = results.flatMap((r) => (r && r.ok ? r.data : []));

    if (hits.length === 0) {
      const firstFailure = results.find((r) => r && !r.ok) as Unavailable | undefined;
      return firstFailure ?? unavailable('not_found', `no results for "${query}"`);
    }
    return { ok: true, data: hits };
  },
};

/**
 * Market-wide data for the dashboard. Keyed by window rather than by symbol, so
 * one fetch serves every viewer for the life of the TTL.
 */
export const marketWide = {
  async earnings(from: string, to: string): Promise<ProviderResult<EarningsEvent[]>> {
    return cached(
      cacheKey('earnings', from, to),
      TTL.calendar,
      () => resolve<EarningsEvent[]>('earnings', (p) => p.earnings?.(from, to)),
      resultTtl(TTL.calendar),
    );
  },

  async economicCalendar(from: string, to: string): Promise<ProviderResult<EconomicEvent[]>> {
    return cached(
      cacheKey('economic', from, to),
      TTL.calendar,
      () => resolve<EconomicEvent[]>('economic.calendar', (p) => p.economicCalendar?.(from, to)),
      resultTtl(TTL.calendar),
    );
  },

  async fearGreed(): Promise<ProviderResult<FearGreed>> {
    return cached(
      cacheKey('feargreed'),
      TTL.fearGreed,
      () => resolve<FearGreed>('fear.greed', (p) => p.fearGreed?.()),
      resultTtl(TTL.fearGreed),
    );
  },
};

/** Provider health for the admin panel. */
export function providerStatus(): {
  id: string;
  label: string;
  configured: boolean;
  capabilities: readonly Capability[];
}[] {
  return ALL.map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    capabilities: p.capabilities,
  }));
}

export { ALL as allProviders };
