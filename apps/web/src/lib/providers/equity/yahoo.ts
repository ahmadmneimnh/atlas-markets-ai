import { fetchJson } from '@/lib/http';
import type { Market, OhlcvSeries, Provider, ProviderResult, Quote, SearchHit } from '../types';
import { MARKET_SUFFIX, ok, unavailable } from '../types';
import { classifyError } from '../errors';
import { setNumber } from '../util';

/**
 * Yahoo Finance — the fallback that needs no key, covering every venue in the
 * brief through its suffix convention (`BP.L`, `SAP.DE`, `0700.HK`, `7203.T`,
 * `BHP.AX`, `SHOP.TO`).
 *
 * Two things to be honest about, because they decide where this sits in the
 * priority order rather than being footnotes:
 *
 *  - **It is an undocumented endpoint, not a product.** There is no contract, no
 *    status page and no support. It changes without notice. It is therefore
 *    ranked *last* for every capability — a free fallback that fills gaps, never
 *    the primary source for a number a user acts on.
 *  - **Yahoo's terms restrict programmatic use.** Fine for local development and
 *    evaluation; check them before shipping this commercially. The adapter is
 *    isolated precisely so it can be dropped from `ALL` in one line.
 *
 * Rate limiting is conservative for the same reason: there is no published quota,
 * so the only safe assumption is that aggressive polling gets an IP blocked.
 */
const QUOTE_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEARCH_BASE = 'https://query2.finance.yahoo.com/v1/finance/search';
const LIMIT = { requests: 20, windowMs: 60_000 };

// Yahoo returns 403 to requests without a browser-shaped User-Agent.
const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
};

interface YahooChart {
  chart?: {
    error?: { code: string; description: string } | null;
    result?: {
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        regularMarketVolume?: number;
        currency?: string;
        regularMarketTime?: number;
        exchangeName?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: {
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }[];
      };
    }[];
  };
}

interface YahooSearch {
  quotes?: {
    symbol: string;
    shortname?: string;
    longname?: string;
    exchange?: string;
    quoteType?: string;
  }[];
}

const EXCHANGE_TO_MARKET: Record<string, Market> = {
  NYQ: 'NYSE',
  NMS: 'NASDAQ',
  NGM: 'NASDAQ',
  ASE: 'AMEX',
  LSE: 'LSE',
  FRA: 'FRA',
  GER: 'XETRA',
  PAR: 'EURONEXT',
  AMS: 'EURONEXT',
  EBS: 'SIX',
  HKG: 'HKEX',
  JPX: 'TSE',
  ASX: 'ASX',
  TOR: 'TSX',
  VAN: 'TSXV',
  SAO: 'BVMF',
  JNB: 'JSE',
  NSI: 'NSE',
  BSE: 'BSE',
  SHH: 'SSE',
  SHZ: 'SZSE',
};

const RANGE: Record<'1d' | '1h' | '1w', { range: string; interval: string }> = {
  '1h': { range: '1mo', interval: '1h' },
  '1d': { range: '2y', interval: '1d' },
  '1w': { range: '10y', interval: '1wk' },
};

export const yahoo: Provider = {
  id: 'yahoo',
  label: 'Yahoo Finance',
  capabilities: ['quote', 'ohlcv', 'search'],

  // No credential to check: the endpoints are unauthenticated.
  isConfigured: () => true,

  async quote(symbol: string): Promise<ProviderResult<Quote>> {
    try {
      const r = await fetchJson<YahooChart>({
        provider: 'yahoo',
        url: `${QUOTE_BASE}/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
        headers: HEADERS,
        rateLimit: LIMIT,
      });

      if (r.chart?.error) {
        return unavailable('not_found', r.chart.error.description);
      }

      const meta = r.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (!meta || typeof price !== 'number' || !Number.isFinite(price)) {
        return unavailable('not_found', `no quote for ${symbol}`);
      }

      const previousClose = meta.previousClose ?? meta.chartPreviousClose;
      const change = previousClose !== undefined ? price - previousClose : 0;

      const quote: Quote = {
        symbol,
        price,
        change,
        changePercent:
          previousClose !== undefined && previousClose !== 0 ? (change / previousClose) * 100 : 0,
        source: 'yahoo',
        asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000) : new Date(),
      };
      setNumber(quote, 'previousClose', previousClose);
      setNumber(quote, 'volume', meta.regularMarketVolume);
      if (meta.currency) quote.currency = meta.currency;
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
    const spec = RANGE[interval];
    try {
      const r = await fetchJson<YahooChart>({
        provider: 'yahoo',
        url: `${QUOTE_BASE}/${encodeURIComponent(symbol)}?range=${spec.range}&interval=${spec.interval}`,
        headers: HEADERS,
        rateLimit: LIMIT,
      });

      if (r.chart?.error) return unavailable('not_found', r.chart.error.description);

      const result = r.chart?.result?.[0];
      const timestamps = result?.timestamp;
      const series = result?.indicators?.quote?.[0];
      if (!timestamps?.length || !series) {
        return unavailable('not_found', `no series for ${symbol}`);
      }

      const candles: OhlcvSeries['candles'] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const open = series.open?.[i];
        const high = series.high?.[i];
        const low = series.low?.[i];
        const close = series.close?.[i];
        const timestamp = timestamps[i];

        // Yahoo pads its arrays with nulls for halted sessions and holidays. A
        // null forward-filled from the previous close would invent a flat candle;
        // dropping the row is the only representation that stays true.
        if (
          timestamp === undefined ||
          open == null ||
          high == null ||
          low == null ||
          close == null
        ) {
          continue;
        }

        candles.push({
          time: new Date(timestamp * 1000),
          open,
          high,
          low,
          close,
          volume: series.volume?.[i] ?? 0,
        });
      }

      if (candles.length === 0) return unavailable('upstream_error', 'no usable candles');

      const trimmed = candles.slice(-limit);
      const last = trimmed[trimmed.length - 1];
      return ok({
        symbol,
        interval,
        candles: trimmed,
        source: 'yahoo',
        asOf: last?.time ?? new Date(),
      });
    } catch (error) {
      return classifyError(error);
    }
  },

  async search(query: string): Promise<ProviderResult<SearchHit[]>> {
    try {
      const r = await fetchJson<YahooSearch>({
        provider: 'yahoo',
        url: `${SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=20&newsCount=0`,
        headers: HEADERS,
        rateLimit: LIMIT,
      });

      const hits = (r.quotes ?? [])
        .filter((q) => q.quoteType === 'EQUITY' || q.quoteType === 'CRYPTOCURRENCY')
        .map((q): SearchHit | null => {
          const isCrypto = q.quoteType === 'CRYPTOCURRENCY';
          const market = isCrypto ? ('CRYPTO' as Market) : EXCHANGE_TO_MARKET[q.exchange ?? ''];
          if (!market) return null;
          return {
            symbol: q.symbol,
            name: q.longname ?? q.shortname ?? q.symbol,
            market,
            kind: isCrypto ? ('crypto' as const) : ('equity' as const),
            source: 'yahoo',
          };
        })
        .filter((hit): hit is SearchHit => hit !== null);

      return hits.length > 0 ? ok(hits) : unavailable('not_found', `no matches for ${query}`);
    } catch (error) {
      return classifyError(error);
    }
  },
};

/** `BP` on LSE → `BP.L`. Yahoo's suffix scheme is the one `MARKET_SUFFIX` encodes. */
export function yahooSymbol(symbol: string, market: Market): string {
  return `${symbol}${MARKET_SUFFIX[market]}`;
}
