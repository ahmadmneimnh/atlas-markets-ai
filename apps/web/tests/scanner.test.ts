import { describe, expect, it } from 'vitest';

import {
  ACTIONABLE_CONFIDENCE,
  citationSummary,
  scan,
  type ScannerInput,
} from '@/lib/scanner/rank';
import type { AssetScore, Recommendation, Signal } from '@/lib/analysis/types';

function signal(label: string, value: string, source = 'finnhub'): Signal {
  return { label, value, direction: 'bullish', weight: 0.4, source };
}

function input(
  symbol: string,
  score: number,
  recommendation: Recommendation,
  confidence: number,
  options: { citations?: Signal[]; price?: number } = {},
): ScannerInput {
  const assetScore: AssetScore = {
    ref: { symbol, market: 'NASDAQ', kind: 'equity' },
    score,
    recommendation,
    confidence,
    breakdown: [],
    omitted: [],
    topReasons: options.citations ?? [signal('RSI(14)', '31.2')],
    sources: ['finnhub'],
    risk: { severity: 'low', drivers: [], caveats: [] },
    computedAt: new Date('2026-08-01T12:00:00Z'),
  };

  const item: ScannerInput = { name: `${symbol} Inc.`, score: assetScore };
  if (options.price !== undefined) {
    item.quote = {
      symbol,
      price: options.price,
      change: 1,
      changePercent: 1.5,
      source: 'finnhub',
      asOf: new Date(),
    };
  }
  return item;
}

describe('scan', () => {
  it('ranks buys by score, best first', () => {
    const result = scan(
      [
        input('LOW', 64, 'BUY', 80),
        input('TOP', 91, 'STRONG_BUY', 80),
        input('MID', 73, 'STRONG_BUY', 80),
      ],
      3,
    );

    expect(result.buy.map((o) => o.symbol)).toEqual(['TOP', 'MID', 'LOW']);
  });

  it('ranks sells ascending, so the strongest sell signal leads', () => {
    const result = scan([input('MILD', 40, 'SELL', 80), input('WORST', 9, 'STRONG_SELL', 80)], 2);

    // The lowest score is the strongest sell — it must not be buried at the end.
    expect(result.sell.map((o) => o.symbol)).toEqual(['WORST', 'MILD']);
  });

  it('excludes low-confidence assets from actionable lists and reports them', () => {
    const result = scan(
      [input('THIN', 95, 'STRONG_BUY', ACTIONABLE_CONFIDENCE - 1), input('SOLID', 70, 'BUY', 80)],
      2,
    );

    // A 95 built on almost nothing is not a better opportunity than a 70 built
    // on real evidence — it is a less-examined one.
    expect(result.buy.map((o) => o.symbol)).toEqual(['SOLID']);
    expect(result.lowConfidence.map((o) => o.symbol)).toEqual(['THIN']);
  });

  it('never silently drops a low-confidence asset', () => {
    const result = scan([input('THIN', 95, 'STRONG_BUY', 10)], 1);

    expect(result.buy).toHaveLength(0);
    expect(result.lowConfidence).toHaveLength(1);
    // Still present in the complete by-band view, so nothing vanishes.
    expect(result.byBand.STRONG_BUY.map((o) => o.symbol)).toEqual(['THIN']);
  });

  it('reports coverage against what was attempted, not what came back', () => {
    const result = scan([input('A', 70, 'BUY', 80)], 12);

    // Inferring `attempted` from the input length would always report 100% and
    // hide exactly the gap a reader needs to judge the list.
    expect(result.coverage).toEqual({ scored: 1, attempted: 12 });
  });

  it('carries citations and providers onto every ranked entry', () => {
    const result = scan(
      [input('A', 80, 'BUY', 80, { citations: [signal('MACD', 'bullish cross')] })],
      1,
    );

    const [top] = result.buy;
    expect(top?.citations).toHaveLength(1);
    expect(top?.citations[0]?.source).toBe('finnhub');
    expect(top?.providers).toEqual(['finnhub']);
  });

  it('groups every band, including empty ones, so the UI need not guess', () => {
    const result = scan([input('A', 80, 'BUY', 80)], 1);

    expect(Object.keys(result.byBand).sort()).toEqual(
      ['BUY', 'HOLD', 'SELL', 'STRONG_BUY', 'STRONG_SELL'].sort(),
    );
    expect(result.byBand.STRONG_SELL).toEqual([]);
  });

  it('carries the quote through when one exists, and omits it when it does not', () => {
    const result = scan(
      [input('WITH', 80, 'BUY', 80, { price: 142.5 }), input('WITHOUT', 79, 'BUY', 80)],
      2,
    );

    expect(result.buy[0]?.price).toBe(142.5);
    // Absent, not zero — a zero price would render as a real, catastrophic value.
    expect(result.buy[1]?.price).toBeUndefined();
  });
});

describe('citationSummary', () => {
  it('names the strongest signal and its provider', () => {
    const result = scan(
      [input('A', 80, 'BUY', 80, { citations: [signal('RSI(14)', '28.4', 'binance')] })],
      1,
    );

    expect(citationSummary(result.buy[0]!)).toBe('RSI(14) 28.4 (binance)');
  });

  it('returns undefined rather than inventing a sentence when nothing was cited', () => {
    const result = scan([input('A', 80, 'BUY', 80, { citations: [] })], 1);

    expect(citationSummary(result.buy[0]!)).toBeUndefined();
  });
});
