import { describe, it, expect } from 'vitest';
import { toChartDTO, toRowDTO, toQuoteDTO, explainUnavailable, RANGE_DAYS } from '@/lib/dto';
import { ok, unavailable, type Candle, type OhlcvSeries, type Quote } from '@/lib/providers/types';

const day = 24 * 60 * 60 * 1000;

function seriesOf(days: number, endingDaysAgo = 0): OhlcvSeries {
  const candles: Candle[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const time = new Date(Date.now() - (i + endingDaysAgo) * day);
    candles.push({ time, open: 100, high: 101, low: 99, close: 100 + i, volume: 10 });
  }
  return { symbol: 'BTC', interval: '1d', candles, source: 'binance', asOf: new Date() };
}

describe('chart serialisation', () => {
  it('keeps only the candles inside the requested window', () => {
    const dto = toChartDTO(seriesOf(400), 'crypto', '1M');
    // The cut-off is inclusive, so a 31-day window admits the bar sitting exactly
    // on the boundary as well.
    expect(dto.points.length).toBeLessThanOrEqual(RANGE_DAYS['1M'] + 1);
    expect(dto.points.length).toBeGreaterThan(25);

    const oldest = dto.points[0]!.t;
    expect(Date.now() - oldest).toBeLessThanOrEqual(RANGE_DAYS['1M'] * day + day);
  });

  it('returns an empty series rather than older prices when history predates the window', () => {
    // A provider whose most recent bar is two months old has nothing to say about
    // the last week. Showing those bars as "1W" would misdate every point on screen.
    const dto = toChartDTO(seriesOf(30, 60), 'crypto', '1W');
    expect(dto.points).toEqual([]);
  });

  it('shows a short series as-is when the provider has less history than requested', () => {
    const dto = toChartDTO(seriesOf(9), 'crypto', '1Y');
    expect(dto.points).toHaveLength(9);
  });
});

describe('quote serialisation', () => {
  const quote: Quote = {
    symbol: 'BTC',
    price: 94_812.37,
    change: 2_231.4,
    changePercent: 2.41,
    source: 'coingecko',
    asOf: new Date('2026-08-01T12:00:00Z'),
  };

  it('omits absent optional fields instead of defaulting them to zero', () => {
    const dto = toQuoteDTO(quote);
    expect(dto).not.toHaveProperty('open');
    expect(dto).not.toHaveProperty('volume');
    expect(dto.asOf).toBe('2026-08-01T12:00:00.000Z');
  });

  it('carries the failure reason on a row instead of dropping the asset', () => {
    const row = toRowDTO(
      { symbol: 'AAPL', name: 'Apple Inc.', kind: 'equity' },
      unavailable('no_provider_configured', 'no key'),
    );
    expect(row.quote).toBeNull();
    expect(row.unavailable?.reason).toBe('no_provider_configured');
    // The row survives so the table can render "Insufficient Data" against Apple
    // rather than silently omitting it.
    expect(row.symbol).toBe('AAPL');
  });

  it('reports no failure when the quote succeeded', () => {
    const row = toRowDTO({ symbol: 'BTC', name: 'Bitcoin', kind: 'crypto' }, ok(quote));
    expect(row.unavailable).toBeNull();
    expect(row.quote?.price).toBe(94_812.37);
  });
});

describe('failure explanations', () => {
  it('points a missing key at the file the user has to edit', () => {
    expect(explainUnavailable({ reason: 'no_provider_configured' })).toMatch(/\.env\.local/);
  });

  it('has wording for every reason, including none at all', () => {
    expect(explainUnavailable(null)).toBeTruthy();
    expect(explainUnavailable({ reason: 'rate_limited' })).toMatch(/limit/i);
  });
});
