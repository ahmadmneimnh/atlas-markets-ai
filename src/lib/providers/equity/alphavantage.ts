import { env } from '@/lib/env';
import { fetchJson } from '@/lib/http';
import type { Provider, ProviderResult, OhlcvSeries, Candle, Fundamentals } from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';
import { setNumber } from '../util';

/**
 * Alpha Vantage. Two quirks are handled here so they never reach the domain:
 *
 *  1. It answers HTTP 200 for quota exhaustion, putting the message in a "Note" or
 *     "Information" field. Parsed naively that becomes an empty series that looks
 *     like "this stock has no price history" rather than "we are rate limited".
 *  2. Every numeric is a string, including in nested objects.
 *
 * The free tier is 25 requests/day, so this provider is configured as a fallback for
 * OHLCV rather than a primary — it will exhaust its quota almost immediately if used
 * for anything high-frequency.
 */

const BASE = 'https://www.alphavantage.co/query';
const LIMIT = { requests: 25, windowMs: 24 * 60 * 60 * 1000 };

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && v !== 'None' && v !== '-') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

type Envelope = Record<string, unknown>;

/** Detects the 200-with-an-error-in-the-body case. */
function quotaMessage(r: Envelope): string | null {
  for (const key of ['Note', 'Information', 'Error Message']) {
    const v = r[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function url(params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, apikey: env.providers.alphaVantage ?? '' });
  return `${BASE}?${q}`;
}

export const alphavantage: Provider = {
  id: 'alphavantage',
  label: 'Alpha Vantage',
  capabilities: ['ohlcv', 'fundamentals'],

  isConfigured: () => Boolean(env.providers.alphaVantage),

  async ohlcv(symbol: string, interval, limitCount: number): Promise<ProviderResult<OhlcvSeries>> {
    if (interval !== '1d') return unavailable('not_supported', 'adapter serves daily bars only');
    try {
      const r = await fetchJson<Envelope>({
        provider: 'alphavantage',
        url: url({
          function: 'TIME_SERIES_DAILY',
          symbol,
          outputsize: limitCount > 100 ? 'full' : 'compact',
        }),
        rateLimit: LIMIT,
      });

      const note = quotaMessage(r);
      if (note) {
        return unavailable(
          /limit|frequency|premium/i.test(note) ? 'rate_limited' : 'upstream_error',
          note.slice(0, 200),
        );
      }

      const series = r['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined;
      if (!series) return unavailable('not_found', `no daily series for ${symbol}`);

      const candles: Candle[] = Object.entries(series)
        .map(([date, bar]) => {
          const open = num(bar['1. open']);
          const high = num(bar['2. high']);
          const low = num(bar['3. low']);
          const close = num(bar['4. close']);
          const volume = num(bar['5. volume']);
          if (open === undefined || high === undefined || low === undefined || close === undefined) {
            return null;
          }
          return { time: new Date(date), open, high, low, close, volume: volume ?? 0 };
        })
        .filter((c): c is Candle => c !== null)
        .sort((a, b) => a.time.getTime() - b.time.getTime());

      if (candles.length === 0) return unavailable('not_found', `empty series for ${symbol}`);

      return ok({
        symbol,
        interval: '1d',
        candles: candles.slice(-limitCount),
        source: 'alphavantage',
        asOf: new Date(),
      });
    } catch (e) {
      return classifyError(e);
    }
  },

  async fundamentals(symbol: string): Promise<ProviderResult<Fundamentals>> {
    try {
      const r = await fetchJson<Envelope>({
        provider: 'alphavantage',
        url: url({ function: 'OVERVIEW', symbol }),
        rateLimit: LIMIT,
      });

      const note = quotaMessage(r);
      if (note) {
        return unavailable(/limit|frequency|premium/i.test(note) ? 'rate_limited' : 'upstream_error', note.slice(0, 200));
      }
      if (!r['Symbol']) return unavailable('not_found', `no overview for ${symbol}`);

      const out: Fundamentals = { symbol, source: 'alphavantage', asOf: new Date() };
      setNumber(out, 'peRatio', num(r['PERatio']));
      setNumber(out, 'pegRatio', num(r['PEGRatio']));
      setNumber(out, 'eps', num(r['EPS']));
      setNumber(out, 'profitMargin', num(r['ProfitMargin']));
      setNumber(out, 'roe', num(r['ReturnOnEquityTTM']));
      setNumber(out, 'marketCap', num(r['MarketCapitalization']));
      setNumber(out, 'dividendYield', num(r['DividendYield']));
      setNumber(out, 'revenueGrowthYoY', num(r['QuarterlyRevenueGrowthYOY']));
      setNumber(out, 'earningsGrowthYoY', num(r['QuarterlyEarningsGrowthYOY']));

      return ok(out);
    } catch (e) {
      return classifyError(e);
    }
  },
};
