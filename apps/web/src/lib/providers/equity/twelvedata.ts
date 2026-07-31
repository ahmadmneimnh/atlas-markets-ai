import { env } from '@/lib/env';
import { fetchJson } from '@/lib/http';
import type { Market, OhlcvSeries, Provider, ProviderResult, Quote, SearchHit } from '../types';
import { MARKET_SUFFIX, ok, unavailable } from '../types';
import { classifyError } from '../errors';

/**
 * TwelveData — the broadest venue coverage of the equity adapters: US, LSE,
 * Frankfurt/XETRA, Hong Kong, Tokyo, ASX and TSX all through one symbol space.
 *
 * Free tier is 8 requests/minute and 800/day. Everything numeric arrives as a
 * **string**, including prices, so nothing here reads a field without going
 * through `num()` — a `"142.30"` that reaches an indicator as a string turns
 * every subsequent arithmetic operation into concatenation or NaN.
 */
const BASE = 'https://api.twelvedata.com';
const LIMIT = { requests: 8, windowMs: 60_000 };

interface TdQuote {
  symbol?: string;
  name?: string;
  exchange?: string;
  currency?: string;
  datetime?: string;
  timestamp?: number;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  /** Error envelope; arrives with HTTP 200. */
  status?: string;
  code?: number;
  message?: string;
}

interface TdTimeSeries {
  values?: {
    datetime: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }[];
  status?: string;
  code?: number;
  message?: string;
}

interface TdSymbolSearch {
  data?: { symbol: string; instrument_name: string; exchange: string; country: string }[];
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function url(path: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, apikey: env.providers.twelveData ?? '' });
  return `${BASE}${path}?${q}`;
}

/**
 * TwelveData signals errors inside a 200 body — `status: "error"` with a code.
 * 429 is its rate-limit code, and treating it as a generic failure would let the
 * registry fall through and burn another vendor's quota on a request that would
 * have succeeded a minute later.
 */
function envelopeError(body: { status?: string; code?: number; message?: string }) {
  if (body.status !== 'error') return null;
  if (body.code === 429) return unavailable('rate_limited', body.message ?? 'twelvedata 429');
  if (body.code === 404) return unavailable('not_found', body.message ?? 'unknown symbol');
  return unavailable('upstream_error', body.message ?? 'twelvedata error');
}

const EXCHANGE_TO_MARKET: Record<string, Market> = {
  NYSE: 'NYSE',
  NASDAQ: 'NASDAQ',
  LSE: 'LSE',
  XETR: 'XETRA',
  FSX: 'FRA',
  HKEX: 'HKEX',
  TSE: 'TSE',
  ASX: 'ASX',
  TSX: 'TSX',
  Euronext: 'EURONEXT',
};

const INTERVAL: Record<'1d' | '1h' | '1w', string> = {
  '1h': '1h',
  '1d': '1day',
  '1w': '1week',
};

export const twelvedata: Provider = {
  id: 'twelvedata',
  label: 'TwelveData',
  capabilities: ['quote', 'ohlcv', 'search'],

  isConfigured: () => Boolean(env.providers.twelveData),

  async quote(symbol: string): Promise<ProviderResult<Quote>> {
    try {
      const r = await fetchJson<TdQuote>({
        provider: 'twelvedata',
        url: url('/quote', { symbol }),
        rateLimit: LIMIT,
      });

      const envelope = envelopeError(r);
      if (envelope) return envelope;

      const price = num(r.close);
      if (price === undefined) return unavailable('not_found', `no quote for ${symbol}`);

      const previousClose = num(r.previous_close);
      const change = num(r.change) ?? (previousClose !== undefined ? price - previousClose : 0);
      const changePercent =
        num(r.percent_change) ??
        (previousClose !== undefined && previousClose !== 0 ? (change / previousClose) * 100 : 0);

      const quote: Quote = {
        symbol,
        price,
        change,
        changePercent,
        source: 'twelvedata',
        asOf: r.timestamp ? new Date(r.timestamp * 1000) : new Date(),
      };

      const open = num(r.open);
      const high = num(r.high);
      const low = num(r.low);
      const volume = num(r.volume);
      if (open !== undefined) quote.open = open;
      if (high !== undefined) quote.high = high;
      if (low !== undefined) quote.low = low;
      if (volume !== undefined) quote.volume = volume;
      if (previousClose !== undefined) quote.previousClose = previousClose;
      if (r.currency) quote.currency = r.currency;

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
    try {
      const r = await fetchJson<TdTimeSeries>({
        provider: 'twelvedata',
        url: url('/time_series', {
          symbol,
          interval: INTERVAL[interval],
          outputsize: String(Math.min(limit, 5000)),
          order: 'ASC',
        }),
        rateLimit: LIMIT,
      });

      const envelope = envelopeError(r);
      if (envelope) return envelope;
      if (!r.values?.length) return unavailable('not_found', `no series for ${symbol}`);

      const candles = r.values
        .map((v) => ({
          time: new Date(v.datetime.includes(':') ? v.datetime : `${v.datetime}T00:00:00Z`),
          open: num(v.open) ?? Number.NaN,
          high: num(v.high) ?? Number.NaN,
          low: num(v.low) ?? Number.NaN,
          close: num(v.close) ?? Number.NaN,
          volume: num(v.volume) ?? 0,
        }))
        // A row with an unparseable OHLC is dropped rather than zero-filled. A
        // zero candle is a 100% drawdown to every indicator that reads it.
        .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.open));

      if (candles.length === 0) return unavailable('upstream_error', 'no parseable candles');

      const last = candles[candles.length - 1];
      return ok({
        symbol,
        interval,
        candles,
        source: 'twelvedata',
        asOf: last?.time ?? new Date(),
      });
    } catch (error) {
      return classifyError(error);
    }
  },

  async search(query: string): Promise<ProviderResult<SearchHit[]>> {
    try {
      const r = await fetchJson<TdSymbolSearch>({
        provider: 'twelvedata',
        url: url('/symbol_search', { symbol: query, outputsize: '20' }),
        rateLimit: LIMIT,
      });

      const hits = (r.data ?? [])
        .map((d): SearchHit | null => {
          const market = EXCHANGE_TO_MARKET[d.exchange];
          // Unmapped venue → dropped, not guessed. A hit labelled NASDAQ that is
          // actually on the Borsa Italiana produces a detail page that queries the
          // wrong instrument forever.
          if (!market) return null;
          return {
            symbol: d.symbol,
            name: d.instrument_name,
            market,
            kind: 'equity' as const,
            source: 'twelvedata',
          };
        })
        .filter((hit): hit is SearchHit => hit !== null);

      return hits.length > 0 ? ok(hits) : unavailable('not_found', `no matches for ${query}`);
    } catch (error) {
      return classifyError(error);
    }
  },
};

/** Vendor-specific symbol for a non-US listing, e.g. `BP` on LSE → `BP.L`. */
export function twelveDataSymbol(symbol: string, market: Market): string {
  return `${symbol}${MARKET_SUFFIX[market]}`;
}
