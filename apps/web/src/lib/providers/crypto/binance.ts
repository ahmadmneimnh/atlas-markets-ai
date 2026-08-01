import { fetchJson } from '@/lib/http';
import type { Provider, ProviderResult, Quote, OhlcvSeries, Candle } from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';

/**
 * Binance public market data. Unauthenticated and high-limit, and unlike CoinGecko's
 * /ohlc it returns real volume — which is why it is the preferred OHLCV source for
 * crypto. Without volume, VWAP and the volume-confirmation signals cannot be computed
 * at all (they are skipped, never approximated).
 */

const BASE = 'https://api.binance.com/api/v3';
const LIMIT = { requests: 600, windowMs: 60_000 }; // half the documented 1200/min

const INTERVALS: Record<'1d' | '1h' | '1w', string> = { '1d': '1d', '1h': '1h', '1w': '1w' };

/** Binance quotes against USDT, not USD; the pair symbol differs from the ticker. */
function pair(symbol: string): string {
  const s = symbol.toUpperCase();
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

interface Ticker24 {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  openPrice: string;
  prevClosePrice: string;
  volume: string;
  closeTime: number;
}

type Kline = [number, string, string, string, string, string, number, ...unknown[]];

const n = (s: string): number => Number(s);

export const binance: Provider = {
  id: 'binance',
  label: 'Binance',
  capabilities: ['crypto.quote', 'ohlcv'],
  assetKinds: ['crypto'],

  isConfigured: () => true, // public endpoints need no credential

  async cryptoQuote(symbol: string): Promise<ProviderResult<Quote>> {
    try {
      const r = await fetchJson<Ticker24>({
        provider: 'binance',
        url: `${BASE}/ticker/24hr?symbol=${pair(symbol)}`,
        rateLimit: LIMIT,
      });
      if (!r?.lastPrice) return unavailable('not_found', `no ticker for ${symbol}`);

      return ok({
        symbol: symbol.toUpperCase(),
        price: n(r.lastPrice),
        change: n(r.priceChange),
        changePercent: n(r.priceChangePercent),
        open: n(r.openPrice),
        high: n(r.highPrice),
        low: n(r.lowPrice),
        previousClose: n(r.prevClosePrice),
        volume: n(r.volume),
        currency: 'USDT',
        source: 'binance',
        asOf: r.closeTime ? new Date(r.closeTime) : new Date(),
      });
    } catch (e) {
      return classifyError(e);
    }
  },

  async ohlcv(symbol: string, interval, limitCount: number): Promise<ProviderResult<OhlcvSeries>> {
    try {
      const rows = await fetchJson<Kline[]>({
        provider: 'binance',
        url: `${BASE}/klines?symbol=${pair(symbol)}&interval=${INTERVALS[interval]}&limit=${Math.min(1000, limitCount)}`,
        rateLimit: LIMIT,
      });
      if (!Array.isArray(rows) || rows.length === 0) {
        return unavailable('not_found', `no klines for ${symbol}`);
      }

      const candles: Candle[] = rows.map((k) => ({
        time: new Date(k[0]),
        open: n(k[1]),
        high: n(k[2]),
        low: n(k[3]),
        close: n(k[4]),
        volume: n(k[5]),
      }));

      return ok({
        symbol: symbol.toUpperCase(),
        interval,
        candles,
        source: 'binance',
        asOf: new Date(),
      });
    } catch (e) {
      return classifyError(e);
    }
  },
};
