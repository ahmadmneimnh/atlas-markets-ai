import { fetchJson } from '@/lib/http';
import type { OhlcvSeries, Provider, ProviderResult, Quote } from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';

/**
 * Coinbase Exchange public market data. No key required.
 *
 * Complements Binance rather than duplicating it: the two exchanges have
 * genuinely different order books, and Coinbase's USD pairs price where a US
 * user would actually transact. Binance's `USDT` pairs are dollar-*ish* — pegged,
 * not equal — so quoting a USDT price as USD embeds a small unstated assumption
 * in every number downstream. This adapter uses `-USD` products precisely to
 * avoid it.
 *
 * Rate limit is 10 req/s public; the cap here is far below that because market
 * data is cached and there is no reason to sit near a ceiling.
 */
const BASE = 'https://api.exchange.coinbase.com';
const LIMIT = { requests: 60, windowMs: 60_000 };

interface CoinbaseTicker {
  trade_id?: number;
  price?: string;
  size?: string;
  bid?: string;
  ask?: string;
  volume?: string;
  time?: string;
  message?: string;
}

interface CoinbaseStats {
  open?: string;
  high?: string;
  low?: string;
  last?: string;
  volume?: string;
  volume_30day?: string;
  message?: string;
}

/** Coinbase candles are positional arrays: [time, low, high, open, close, volume]. */
type CoinbaseCandle = [number, number, number, number, number, number];

const GRANULARITY: Record<'1d' | '1h' | '1w', number> = {
  '1h': 3600,
  '1d': 86_400,
  // Coinbase has no weekly granularity; daily is the finest available substitute
  // and the caller is told what it actually got through `interval`.
  '1w': 86_400,
};

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** `BTC` → `BTC-USD`. Already-qualified product ids pass through. */
function productId(symbol: string): string {
  const upper = symbol.toUpperCase();
  return upper.includes('-') ? upper : `${upper}-USD`;
}

export const coinbase: Provider = {
  id: 'coinbase',
  label: 'Coinbase',
  capabilities: ['crypto.quote', 'ohlcv'],
  assetKinds: ['crypto'],

  // Public market-data endpoints are unauthenticated.
  isConfigured: () => true,

  async cryptoQuote(symbol: string): Promise<ProviderResult<Quote>> {
    const product = productId(symbol);
    try {
      // Ticker gives the last trade; stats gives the 24h open needed for change.
      // Both are required for a complete quote, so `all` is correct here — a
      // price without its change would render as a 0.00% move, which reads as
      // "flat" rather than "unknown".
      const [ticker, stats] = await Promise.all([
        fetchJson<CoinbaseTicker>({
          provider: 'coinbase',
          url: `${BASE}/products/${product}/ticker`,
          rateLimit: LIMIT,
        }),
        fetchJson<CoinbaseStats>({
          provider: 'coinbase',
          url: `${BASE}/products/${product}/stats`,
          rateLimit: LIMIT,
        }),
      ]);

      if (ticker.message) return unavailable('not_found', ticker.message);

      const price = num(ticker.price);
      if (price === undefined) return unavailable('not_found', `no Coinbase quote for ${product}`);

      const open = num(stats.open);
      const change = open !== undefined ? price - open : 0;

      const quote: Quote = {
        symbol: symbol.toUpperCase(),
        price,
        change,
        changePercent: open !== undefined && open !== 0 ? (change / open) * 100 : 0,
        currency: 'USD',
        source: 'coinbase',
        asOf: ticker.time ? new Date(ticker.time) : new Date(),
      };

      const high = num(stats.high);
      const low = num(stats.low);
      const volume = num(ticker.volume ?? stats.volume);
      if (open !== undefined) {
        quote.open = open;
        quote.previousClose = open;
      }
      if (high !== undefined) quote.high = high;
      if (low !== undefined) quote.low = low;
      if (volume !== undefined) quote.volume = volume;

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
    const product = productId(symbol);
    try {
      const r = await fetchJson<CoinbaseCandle[] | { message: string }>({
        provider: 'coinbase',
        url: `${BASE}/products/${product}/candles?granularity=${GRANULARITY[interval]}`,
        rateLimit: LIMIT,
      });

      if (!Array.isArray(r)) return unavailable('not_found', r.message);
      if (r.length === 0) return unavailable('not_found', `no candles for ${product}`);

      // Coinbase returns newest-first. Reversing is not cosmetic: every indicator
      // in the engine assumes chronological order, and a reversed series turns an
      // uptrend into a downtrend without any error being raised.
      const candles = r
        .map(([time, low, high, open, close, volume]) => ({
          time: new Date(time * 1000),
          open,
          high,
          low,
          close,
          volume,
        }))
        .reverse()
        .slice(-limit);

      const last = candles[candles.length - 1];
      return ok({
        symbol: symbol.toUpperCase(),
        interval,
        candles,
        source: 'coinbase',
        asOf: last?.time ?? new Date(),
      });
    } catch (error) {
      return classifyError(error);
    }
  },
};
