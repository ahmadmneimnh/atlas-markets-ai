import type { AssetKind, Quote, OhlcvSeries, ProviderResult, UnavailableReason } from './providers/types';

/**
 * Wire shapes shared by the API routes and the client components.
 *
 * Dates cross the network as ISO strings, and a missing value is `null` with a
 * machine-readable reason attached — never `0`, never an omitted field that a
 * chart would silently plot as a gap in a line.
 */

export interface UnavailableDTO {
  reason: UnavailableReason;
  detail?: string;
}

export interface QuoteDTO {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  volume?: number;
  currency?: string;
  source: string;
  asOf: string;
}

/** One row of a market table: either a quote, or the reason there isn't one. */
export interface AssetRowDTO {
  symbol: string;
  name: string;
  kind: AssetKind;
  quote: QuoteDTO | null;
  unavailable: UnavailableDTO | null;
}

export interface ChartPointDTO {
  /** Epoch milliseconds. */
  t: number;
  close: number;
}

export interface ChartDTO {
  symbol: string;
  kind: AssetKind;
  range: ChartRange;
  points: ChartPointDTO[];
  source: string;
}

export const CHART_RANGES = ['1W', '1M', '3M', '6M', '1Y'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

/** Calendar days of history each range needs. */
export const RANGE_DAYS: Record<ChartRange, number> = {
  '1W': 7,
  '1M': 31,
  '3M': 92,
  '6M': 183,
  '1Y': 366,
};

export function isChartRange(value: string): value is ChartRange {
  return (CHART_RANGES as readonly string[]).includes(value);
}

// ── Serialisers (server side) ───────────────────────────────────────────────────

export function toQuoteDTO(q: Quote): QuoteDTO {
  return {
    symbol: q.symbol,
    price: q.price,
    change: q.change,
    changePercent: q.changePercent,
    ...(q.open !== undefined ? { open: q.open } : {}),
    ...(q.high !== undefined ? { high: q.high } : {}),
    ...(q.low !== undefined ? { low: q.low } : {}),
    ...(q.previousClose !== undefined ? { previousClose: q.previousClose } : {}),
    ...(q.volume !== undefined ? { volume: q.volume } : {}),
    ...(q.currency !== undefined ? { currency: q.currency } : {}),
    source: q.source,
    asOf: q.asOf.toISOString(),
  };
}

export function toUnavailableDTO(result: ProviderResult<unknown>): UnavailableDTO | null {
  if (result.ok) return null;
  return { reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) };
}

export function toRowDTO(
  ref: { symbol: string; name: string; kind: AssetKind },
  result: ProviderResult<Quote>,
): AssetRowDTO {
  return {
    ...ref,
    quote: result.ok ? toQuoteDTO(result.data) : null,
    unavailable: toUnavailableDTO(result),
  };
}

export function toChartDTO(
  series: OhlcvSeries,
  kind: AssetKind,
  range: ChartRange,
): ChartDTO {
  const cutoff = Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
  const points = series.candles
    .filter((c) => c.time.getTime() >= cutoff)
    .map((c) => ({ t: c.time.getTime(), close: c.close }));

  return {
    symbol: series.symbol,
    kind,
    range,
    // Whatever falls inside the window, and nothing else. If the provider's history
    // is shorter than the window the chart is short; if its history ends before the
    // window starts the chart is empty and the UI says "Insufficient Data". Falling
    // back to the full series here would label year-old prices as this week's.
    points,
    source: series.source,
  };
}

// ── Human-readable failure text ─────────────────────────────────────────────────

/**
 * One sentence a non-technical user can act on. Reasons map to causes, not to HTTP
 * jargon, because the person reading this is usually the person who has to go and
 * add the missing API key.
 */
export function explainUnavailable(u: UnavailableDTO | null | undefined): string {
  switch (u?.reason) {
    case 'no_provider_configured':
      return 'No data source is set up for this. Add the matching API key to your .env.local file.';
    case 'not_found':
      return 'The data source does not recognise this symbol.';
    case 'rate_limited':
      return 'The free data plan has hit its request limit. It will work again shortly.';
    case 'timeout':
      return 'The data source did not respond in time.';
    case 'circuit_open':
      return 'The data source failed repeatedly and is being left alone for a minute.';
    case 'not_supported':
      return 'This data source cannot provide this figure.';
    case 'upstream_error':
      return 'The data source returned an error.';
    default:
      return 'No data was returned by any source.';
  }
}
