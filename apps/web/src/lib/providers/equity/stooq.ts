import { fetchText } from '@/lib/http';
import type { Candle, OhlcvSeries, Provider, ProviderResult } from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';

/**
 * Stooq — free daily OHLCV for equities, no credential required.
 *
 * This exists because of a gap that made the project's own recommended setup
 * unable to produce a score. Finnhub is documented as the first key to obtain,
 * and it covers quotes, profiles, fundamentals, news and search — but its
 * candle endpoint is premium, so the adapter does not implement `ohlcv` at all.
 * Every other OHLCV provider in the default order is either crypto-only
 * (Binance, Coinbase, CoinGecko) or needs its own key (TwelveData, Polygon,
 * Alpha Vantage). That left Yahoo as the sole equity candidate, and Yahoo
 * rate-limits almost immediately.
 *
 * The consequence was not a missing chart. Without price history the technical
 * factor (30% of the weight) and the risk factor (5%) both report unavailable,
 * and the decision module has no ATR, so it cannot place an entry, target or
 * stop for any equity. A Finnhub-only deployment could reach at most 45%
 * coverage and never produce a single price level.
 *
 * Stooq answers a plain CSV over HTTP with no key, no quota headers and no
 * account. It is ordered ahead of Yahoo for that reason, and behind the keyed
 * vendors because it offers daily bars only — no intraday, no weekly — and
 * publishes no uptime commitment.
 */

const BASE = 'https://stooq.com/q/d/l/';
// Courtesy limit. Stooq publishes no documented ceiling; this keeps a
// whole-universe scan from arriving as a burst.
const LIMIT = { requests: 20, windowMs: 60_000 };

/**
 * Scope: US listings only.
 *
 * Stooq does carry other venues under their own suffixes (`.uk`, `.de`, `.hk`),
 * but `Provider.ohlcv` receives a bare symbol and no `Market` — every OHLCV
 * adapter here has the same constraint — so this cannot know which venue was
 * meant. Guessing is not a neutral choice: a London ticker sent as `.us` does
 * not reliably fail, it can return a *different company* sharing the symbol,
 * and a wrong price series feeding a recommendation is far worse than a missing
 * one. So `.us` is the only mapping, an unknown symbol comes back as
 * `not_found`, and the registry falls through to a keyed provider that does
 * receive enough context to be sure.
 */
export function stooqSymbol(symbol: string): string {
  return `${symbol.toLowerCase()}.us`;
}

/**
 * Parses Stooq's CSV into candles.
 *
 * Exported for testing: this is the part that can be verified without a network,
 * and a parser that mis-handles a short or malformed row is how a fabricated
 * price reaches a chart.
 */
export function parseStooqCsv(csv: string): Candle[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = (lines[0] ?? '').toLowerCase();
  // Stooq answers an unknown symbol with a 200 and the body "No data".
  if (!header.startsWith('date,')) return [];

  const columns = header.split(',');
  const index = {
    date: columns.indexOf('date'),
    open: columns.indexOf('open'),
    high: columns.indexOf('high'),
    low: columns.indexOf('low'),
    close: columns.indexOf('close'),
    volume: columns.indexOf('volume'),
  };
  // Volume is optional on some series; the OHLC columns are not.
  if (Object.entries(index).some(([key, i]) => i === -1 && key !== 'volume')) return [];

  const candles: Candle[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const time = new Date(`${cells[index.date]}T00:00:00Z`);
    if (Number.isNaN(time.getTime())) continue;

    const open = Number(cells[index.open]);
    const high = Number(cells[index.high]);
    const low = Number(cells[index.low]);
    const close = Number(cells[index.close]);
    // A row with a non-numeric or absent OHLC value is dropped rather than
    // coerced. `Number('')` is 0, and a zero price on a chart is not a gap —
    // it reads as a real, catastrophic move.
    if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) continue;

    const rawVolume = index.volume === -1 ? undefined : Number(cells[index.volume]);
    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(rawVolume) && rawVolume !== undefined ? rawVolume : 0,
    });
  }

  // Stooq returns oldest-first, which is the order every indicator expects.
  // Sorted anyway rather than trusted: an out-of-order series would silently
  // produce a wrong RSI rather than an error.
  candles.sort((a, b) => a.time.getTime() - b.time.getTime());
  return candles;
}

export const stooq: Provider = {
  id: 'stooq',
  label: 'Stooq',
  capabilities: ['ohlcv'],
  assetKinds: ['equity'],
  // No credential exists to check. Availability is a network question, and the
  // circuit breaker already answers that one.
  isConfigured: () => true,

  async ohlcv(
    symbol: string,
    interval: '1d' | '1h' | '1w',
    limit: number,
  ): Promise<ProviderResult<OhlcvSeries>> {
    if (interval !== '1d') {
      return unavailable('not_supported', `stooq serves daily bars only, not ${interval}`);
    }

    const mapped = stooqSymbol(symbol);

    try {
      const csv = await fetchText({
        provider: 'stooq',
        url: `${BASE}?s=${encodeURIComponent(mapped)}&i=d`,
        rateLimit: LIMIT,
        timeoutMs: 12_000,
      });

      const candles = parseStooqCsv(csv);
      if (candles.length === 0) {
        return unavailable('not_found', `stooq returned no daily bars for ${symbol}`);
      }

      return ok({
        symbol,
        interval: '1d',
        candles: candles.slice(-limit),
        source: 'stooq',
        asOf: new Date(),
      });
    } catch (error) {
      return classifyError(error);
    }
  },
};
