import { env } from '@/lib/env';
import { fetchJson } from '@/lib/http';
import type {
  CompanyProfile,
  OhlcvSeries,
  Provider,
  ProviderResult,
  Quote,
  SearchHit,
  Market,
} from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';

/**
 * Polygon.io — US equities, with the deepest OHLCV history of the adapters here.
 *
 * Free tier is 5 requests/minute and end-of-day only; the paid tiers unlock
 * real-time. The rate limit below is set for the free tier because that is what
 * an unconfigured-then-configured user will hit first, and a 429 storm on day one
 * is how a vendor evaluation ends early.
 */
const BASE = 'https://api.polygon.io';
const LIMIT = { requests: 5, windowMs: 60_000 };

interface PolygonAgg {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface PolygonAggsResponse {
  status?: string;
  resultsCount?: number;
  results?: PolygonAgg[];
  /** Present on free-tier throttling, alongside HTTP 200. */
  error?: string;
}

interface PolygonPrevClose {
  status?: string;
  results?: { T: string; o: number; h: number; l: number; c: number; v: number; t: number }[];
  error?: string;
}

interface PolygonTickerDetails {
  results?: {
    ticker: string;
    name?: string;
    primary_exchange?: string;
    locale?: string;
    sic_description?: string;
    homepage_url?: string;
    description?: string;
    total_employees?: number;
    branding?: { logo_url?: string; icon_url?: string };
    market_cap?: number;
    currency_name?: string;
  };
  error?: string;
}

interface PolygonSearch {
  results?: { ticker: string; name: string; market: string; primary_exchange?: string }[];
}

function url(path: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ ...params, apiKey: env.providers.polygon ?? '' });
  return `${BASE}${path}?${q}`;
}

/** Polygon returns HTTP 200 with `error` set when the free tier is exhausted. */
function throttled(body: { status?: string; error?: string }): boolean {
  return body.status === 'ERROR' || Boolean(body.error);
}

const EXCHANGE_TO_MARKET: Record<string, Market> = {
  XNYS: 'NYSE',
  XNAS: 'NASDAQ',
  ARCX: 'NYSE',
  BATS: 'NYSE',
  XASE: 'AMEX',
};

const INTERVAL: Record<'1d' | '1h' | '1w', { multiplier: number; timespan: string; days: number }> =
  {
    '1h': { multiplier: 1, timespan: 'hour', days: 30 },
    '1d': { multiplier: 1, timespan: 'day', days: 400 },
    '1w': { multiplier: 1, timespan: 'week', days: 2000 },
  };

export const polygon: Provider = {
  id: 'polygon',
  label: 'Polygon.io',
  capabilities: ['quote', 'ohlcv', 'profile', 'search'],
  assetKinds: ['equity'],

  isConfigured: () => Boolean(env.providers.polygon),

  async quote(symbol: string): Promise<ProviderResult<Quote>> {
    try {
      const r = await fetchJson<PolygonPrevClose>({
        provider: 'polygon',
        url: url(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev`, { adjusted: 'true' }),
        rateLimit: LIMIT,
      });

      if (throttled(r)) return unavailable('rate_limited', r.error ?? 'polygon throttled');

      const bar = r.results?.[0];
      if (!bar) return unavailable('not_found', `no previous close for ${symbol}`);

      // This endpoint is the previous session's aggregate, so `c` is a close and
      // the change is measured against that session's open — not against an
      // earlier close. Labelling it as a live quote would misrepresent both the
      // price and its timestamp, which is why `asOf` is the bar's own time.
      const change = bar.c - bar.o;
      const quote: Quote = {
        symbol,
        price: bar.c,
        change,
        changePercent: bar.o === 0 ? 0 : (change / bar.o) * 100,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        previousClose: bar.o,
        volume: bar.v,
        source: 'polygon',
        asOf: new Date(bar.t),
      };
      return ok(quote);
    } catch (error) {
      return classifyError(error);
    }
  },

  async ohlcv(
    symbol: string,
    interval: '1d' | '1h' | '1w',
    limit: number,
  ): Promise<ProviderResult<OhlcvSeries>> {
    const spec = INTERVAL[interval];
    const to = new Date();
    const from = new Date(to.getTime() - spec.days * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    try {
      const r = await fetchJson<PolygonAggsResponse>({
        provider: 'polygon',
        url: url(
          `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${spec.multiplier}/${spec.timespan}/${iso(from)}/${iso(to)}`,
          { adjusted: 'true', sort: 'asc', limit: String(Math.min(limit * 2, 50_000)) },
        ),
        rateLimit: LIMIT,
      });

      if (throttled(r)) return unavailable('rate_limited', r.error ?? 'polygon throttled');
      if (!r.results?.length) return unavailable('not_found', `no bars for ${symbol}`);

      const candles = r.results.slice(-limit).map((bar) => ({
        time: new Date(bar.t),
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
      }));

      const last = candles[candles.length - 1];
      return ok({
        symbol,
        interval,
        candles,
        source: 'polygon',
        asOf: last?.time ?? new Date(),
      });
    } catch (error) {
      return classifyError(error);
    }
  },

  async profile(symbol: string): Promise<ProviderResult<CompanyProfile>> {
    try {
      const r = await fetchJson<PolygonTickerDetails>({
        provider: 'polygon',
        url: url(`/v3/reference/tickers/${encodeURIComponent(symbol)}`),
        rateLimit: LIMIT,
      });

      if (throttled(r)) return unavailable('rate_limited', r.error ?? 'polygon throttled');
      const d = r.results;
      if (!d?.name) return unavailable('not_found', `no profile for ${symbol}`);

      const profile: CompanyProfile = {
        symbol,
        name: d.name,
        source: 'polygon',
        asOf: new Date(),
      };
      if (d.primary_exchange) profile.exchange = d.primary_exchange;
      if (d.locale) profile.country = d.locale.toUpperCase();
      if (d.sic_description) profile.industry = d.sic_description;
      if (d.homepage_url) profile.website = d.homepage_url;
      if (d.description) profile.description = d.description;
      // Polygon's branding URLs require the API key appended to load, so they are
      // deliberately not surfaced: putting one in an <img src> would leak the key
      // into the browser and into every referrer header.
      return ok(profile);
    } catch (error) {
      return classifyError(error);
    }
  },

  async search(query: string): Promise<ProviderResult<SearchHit[]>> {
    try {
      const r = await fetchJson<PolygonSearch>({
        provider: 'polygon',
        url: url('/v3/reference/tickers', {
          search: query,
          active: 'true',
          market: 'stocks',
          limit: '20',
        }),
        rateLimit: LIMIT,
      });

      const hits = (r.results ?? []).map((t) => ({
        symbol: t.ticker,
        name: t.name,
        market: EXCHANGE_TO_MARKET[t.primary_exchange ?? ''] ?? ('NASDAQ' as Market),
        kind: 'equity' as const,
        source: 'polygon',
      }));

      return hits.length > 0 ? ok(hits) : unavailable('not_found', `no matches for ${query}`);
    } catch (error) {
      return classifyError(error);
    }
  },
};
