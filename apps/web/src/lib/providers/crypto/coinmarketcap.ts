import { env } from '@/lib/env';
import { fetchJson } from '@/lib/http';
import type { CryptoMetrics, Provider, ProviderResult, Quote, SearchHit } from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';
import { setNumber } from '../util';

/**
 * CoinMarketCap — the second crypto opinion.
 *
 * Its value here is not extra data but *disagreement*: CMC and CoinGecko compute
 * volume and supply differently, and a divergence between them is a real signal
 * that one of them is wrong about a thin market. The registry falls through
 * rather than reconciling, so whichever answers first wins and the response says
 * which one it was.
 *
 * Free tier is 10k credits/month, roughly 333/day. The limiter is set for that.
 * The key travels in a header, never a query string, so it cannot leak through a
 * logged URL.
 */
const BASE = 'https://pro-api.coinmarketcap.com/v1';
const LIMIT = { requests: 20, windowMs: 60_000 };

interface CmcStatus {
  error_code?: number;
  error_message?: string | null;
}

interface CmcQuoteResponse {
  status?: CmcStatus;
  data?: Record<
    string,
    {
      id: number;
      name: string;
      symbol: string;
      cmc_rank?: number;
      circulating_supply?: number;
      total_supply?: number;
      max_supply?: number;
      last_updated?: string;
      quote?: {
        USD?: {
          price?: number;
          volume_24h?: number;
          percent_change_24h?: number;
          market_cap?: number;
          last_updated?: string;
        };
      };
    }
  >;
}

interface CmcMapResponse {
  status?: CmcStatus;
  data?: { id: number; name: string; symbol: string; is_active?: number }[];
}

function headers(): Record<string, string> {
  return { 'X-CMC_PRO_API_KEY': env.providers.coinMarketCap ?? '' };
}

/** CMC reports quota and plan errors inside the `status` block, alongside HTTP 200. */
function statusError(status: CmcStatus | undefined) {
  if (!status?.error_code) return null;
  const message = status.error_message ?? `cmc error ${status.error_code}`;
  // 1008/1009/1010 are the rate-limit family; 1002/1006 are auth and plan.
  if ([1008, 1009, 1010, 1011].includes(status.error_code)) {
    return unavailable('rate_limited', message);
  }
  return unavailable('upstream_error', message);
}

export const coinmarketcap: Provider = {
  id: 'coinmarketcap',
  label: 'CoinMarketCap',
  capabilities: ['crypto.quote', 'crypto.metrics', 'search'],
  assetKinds: ['crypto'],

  isConfigured: () => Boolean(env.providers.coinMarketCap),

  async cryptoQuote(symbol: string): Promise<ProviderResult<Quote>> {
    try {
      const r = await fetchJson<CmcQuoteResponse>({
        provider: 'coinmarketcap',
        url: `${BASE}/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbol.toUpperCase())}&convert=USD`,
        headers: headers(),
        rateLimit: LIMIT,
      });

      const failure = statusError(r.status);
      if (failure) return failure;

      const entry = r.data?.[symbol.toUpperCase()];
      const usd = entry?.quote?.USD;
      if (!entry || typeof usd?.price !== 'number') {
        return unavailable('not_found', `no CMC quote for ${symbol}`);
      }

      const changePercent = usd.percent_change_24h ?? 0;
      // CMC gives the percentage but not the absolute change, so it is derived
      // from the percentage rather than left at zero — a zero change next to a
      // non-zero percentage is a contradiction on screen.
      const previous = usd.price / (1 + changePercent / 100);

      const quote: Quote = {
        symbol: symbol.toUpperCase(),
        price: usd.price,
        change: usd.price - previous,
        changePercent,
        currency: 'USD',
        source: 'coinmarketcap',
        asOf: usd.last_updated ? new Date(usd.last_updated) : new Date(),
      };
      setNumber(quote, 'volume', usd.volume_24h);
      setNumber(quote, 'previousClose', previous);
      return ok(quote);
    } catch (error) {
      return classifyError(error);
    }
  },

  async cryptoMetrics(symbol: string): Promise<ProviderResult<CryptoMetrics>> {
    try {
      const r = await fetchJson<CmcQuoteResponse>({
        provider: 'coinmarketcap',
        url: `${BASE}/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbol.toUpperCase())}&convert=USD`,
        headers: headers(),
        rateLimit: LIMIT,
      });

      const failure = statusError(r.status);
      if (failure) return failure;

      const entry = r.data?.[symbol.toUpperCase()];
      if (!entry) return unavailable('not_found', `no CMC metrics for ${symbol}`);

      const metrics: CryptoMetrics = {
        symbol: symbol.toUpperCase(),
        source: 'coinmarketcap',
        asOf: entry.last_updated ? new Date(entry.last_updated) : new Date(),
      };
      setNumber(metrics, 'marketCap', entry.quote?.USD?.market_cap);
      setNumber(metrics, 'volume24h', entry.quote?.USD?.volume_24h);
      setNumber(metrics, 'circulatingSupply', entry.circulating_supply);
      setNumber(metrics, 'totalSupply', entry.total_supply);
      setNumber(metrics, 'maxSupply', entry.max_supply);
      setNumber(metrics, 'rank', entry.cmc_rank);
      // Developer activity is deliberately absent: CMC does not publish it, and
      // leaving the field undefined tells the fundamental scorer to omit that
      // signal instead of scoring a zero commit count as abandonment.
      return ok(metrics);
    } catch (error) {
      return classifyError(error);
    }
  },

  async search(query: string): Promise<ProviderResult<SearchHit[]>> {
    try {
      const r = await fetchJson<CmcMapResponse>({
        provider: 'coinmarketcap',
        url: `${BASE}/cryptocurrency/map?symbol=${encodeURIComponent(query.toUpperCase())}&limit=20`,
        headers: headers(),
        rateLimit: LIMIT,
      });

      const failure = statusError(r.status);
      if (failure) return failure;

      const hits = (r.data ?? [])
        .filter((c) => c.is_active !== 0)
        .map((c) => ({
          symbol: c.symbol,
          name: c.name,
          market: 'CRYPTO' as const,
          kind: 'crypto' as const,
          source: 'coinmarketcap',
        }));

      return hits.length > 0 ? ok(hits) : unavailable('not_found', `no matches for ${query}`);
    } catch (error) {
      return classifyError(error);
    }
  },
};
