import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { cached, cacheKey, resultTtl, TTL } from '@/lib/cache';
import type {
  Provider, Capability, ProviderResult, Quote, OhlcvSeries, Fundamentals,
  CompanyProfile, NewsArticle, CryptoMetrics, SearchHit, Unavailable,
} from './types';
import { unavailable } from './types';

import { finnhub } from './equity/finnhub';
import { alphavantage } from './equity/alphavantage';
import { coingecko } from './crypto/coingecko';
import { binance } from './crypto/binance';

/**
 * Capability-routed provider registry.
 *
 * Call sites ask for a capability ("give me a quote"), never for a vendor. The
 * registry picks among configured providers by priority and falls through on
 * failure. Adding or swapping a vendor therefore touches this file's ALL list and
 * nothing else in the application.
 */

const ALL: Provider[] = [finnhub, alphavantage, coingecko, binance];

/**
 * Default ordering per capability, best-first. Overridable per deployment via
 * ATLAS_PRIORITY_* env vars — that override is the documented swap mechanism.
 */
const DEFAULT_ORDER: Partial<Record<Capability, string[]>> = {
  quote: ['finnhub'],
  ohlcv: ['binance', 'alphavantage', 'coingecko'],
  fundamentals: ['finnhub', 'alphavantage'],
  profile: ['finnhub'],
  news: ['finnhub'],
  'crypto.quote': ['binance', 'coingecko'],
  'crypto.metrics': ['coingecko'],
  search: ['finnhub', 'coingecko'],
};

function envOverride(cap: Capability): string[] {
  switch (cap) {
    case 'quote': return env.priority.quote;
    case 'ohlcv': return env.priority.ohlcv;
    case 'fundamentals': return env.priority.fundamentals;
    case 'news': return env.priority.news;
    default: return [];
  }
}

/** Configured providers implementing `cap`, in resolution order. */
function candidates(cap: Capability): Provider[] {
  const order = envOverride(cap).length > 0 ? envOverride(cap) : (DEFAULT_ORDER[cap] ?? []);
  const byId = new Map(ALL.map((p) => [p.id, p]));

  const ranked = order
    .map((id) => byId.get(id))
    .filter((p): p is Provider => Boolean(p) && p!.capabilities.includes(cap));

  // Any provider supporting the capability but absent from the explicit order is
  // appended, so a newly added adapter is usable before anyone updates config.
  const extras = ALL.filter((p) => p.capabilities.includes(cap) && !ranked.includes(p));

  return [...ranked, ...extras].filter((p) => p.isConfigured());
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
): Promise<ProviderResult<T>> {
  const providers = candidates(cap);
  if (providers.length === 0) {
    return unavailable('no_provider_configured', `no configured provider implements "${cap}"`);
  }

  const tried: string[] = [];
  let last: Unavailable = unavailable('upstream_error', 'no provider attempted');

  for (const p of providers) {
    const call = invoke(p);
    if (!call) continue;
    tried.push(p.id);

    const result = await call;
    if (result.ok) return result;

    last = result;
    if (result.reason === 'not_found') break;

    log.warn('provider_fallthrough', { capability: cap, provider: p.id, reason: result.reason });
  }

  return { ...last, tried };
}

// ── Public API ──────────────────────────────────────────────────────────────────

export const market = {
  async quote(symbol: string, kind: 'equity' | 'crypto'): Promise<ProviderResult<Quote>> {
    const cap: Capability = kind === 'crypto' ? 'crypto.quote' : 'quote';
    const ttl = kind === 'crypto' ? TTL.quoteCrypto : TTL.quoteEquity;

    return cached(
      cacheKey('quote', kind, symbol),
      ttl,
      () => resolve<Quote>(cap, (p) => (kind === 'crypto' ? p.cryptoQuote?.(symbol) : p.quote?.(symbol))),
      resultTtl(ttl),
    );
  },

  async ohlcv(
    symbol: string,
    interval: '1d' | '1h' | '1w' = '1d',
    limit = 260,
  ): Promise<ProviderResult<OhlcvSeries>> {
    return cached(
      cacheKey('ohlcv', symbol, interval, limit),
      TTL.ohlcvDaily,
      () => resolve<OhlcvSeries>('ohlcv', (p) => p.ohlcv?.(symbol, interval, limit)),
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

  async search(query: string): Promise<ProviderResult<SearchHit[]>> {
    // Search fans out rather than falling through: equity and crypto results come
    // from different vendors and the user wants both in one list.
    const providers = candidates('search');
    if (providers.length === 0) return unavailable('no_provider_configured', 'no search provider');

    const results = await Promise.all(providers.map((p) => p.search?.(query) ?? Promise.resolve(null)));
    const hits = results.flatMap((r) => (r && r.ok ? r.data : []));

    if (hits.length === 0) {
      const firstFailure = results.find((r) => r && !r.ok) as Unavailable | undefined;
      return firstFailure ?? unavailable('not_found', `no results for "${query}"`);
    }
    return { ok: true, data: hits };
  },
};

/** Provider health for the admin panel. */
export function providerStatus(): { id: string; label: string; configured: boolean; capabilities: readonly Capability[] }[] {
  return ALL.map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    capabilities: p.capabilities,
  }));
}

export { ALL as allProviders };
