import { describe, expect, it } from 'vitest';

import { fundamentalScorer } from '@/lib/analysis/factors/fundamental';
import { isUnavailable, type AssetContext } from '@/lib/analysis/types';
import { scan, type ScannerInput } from '@/lib/scanner/rank';
import type { AnalystEstimates } from '@/lib/providers/types';
import type { AssetScore as Score } from '@/lib/analysis/types';

/**
 * Covers the wiring added when the real providers were connected: analyst
 * estimates reaching the fundamental factor, and the scanner's complete ranking.
 *
 * Adapter request/response handling is not exercised here — that needs live
 * endpoints, which this environment cannot reach.
 */

function equityContext(over: Partial<AssetContext> = {}): AssetContext {
  return {
    ref: { symbol: 'TEST', market: 'NASDAQ', kind: 'equity' },
    quote: {
      symbol: 'TEST',
      price: 100,
      change: 1,
      changePercent: 1,
      source: 'finnhub',
      asOf: new Date('2026-08-01T12:00:00Z'),
    },
    ...over,
  };
}

/**
 * Runs the fundamental scorer and awaits it.
 *
 * `FactorScorer.score` is declared as sync-or-async so a scorer can call out to
 * a service. This one is synchronous today, which is why an un-awaited version
 * of these tests passed at runtime while failing typecheck — the assertions were
 * silently inspecting a Promise.
 */
async function scoreFundamental(ctx: AssetContext) {
  return fundamentalScorer.score(ctx);
}

function estimates(over: Partial<AnalystEstimates> = {}): AnalystEstimates {
  return {
    symbol: 'TEST',
    source: 'fmp',
    asOf: new Date('2026-08-01T12:00:00Z'),
    ...over,
  };
}

describe('analyst estimates in the fundamental factor', () => {
  it('scores a factor from analyst data alone when no statement metrics arrived', async () => {
    // A vendor serving targets but not fundamentals is a real configuration. An
    // earlier version bailed out before reading them and threw the evidence away.
    const outcome = await scoreFundamental(
      equityContext({ analyst: estimates({ targetConsensus: 130 }) }),
    );

    expect(isUnavailable(outcome)).toBe(false);
    if (isUnavailable(outcome)) return;
    expect(outcome.signals.map((s) => s.label)).toContain('Upside to analyst consensus target');
    expect(outcome.signals[0]?.source).toBe('fmp');
  });

  it('still reports unavailable when neither fundamentals nor analyst data exist', async () => {
    const outcome = await scoreFundamental(equityContext());

    expect(isUnavailable(outcome)).toBe(true);
    if (!isUnavailable(outcome)) return;
    expect(outcome.reason).toContain('no fundamentals');
  });

  it('needs a price to state upside, and omits the signal rather than guessing one', async () => {
    const ctx = equityContext({ analyst: estimates({ targetConsensus: 130 }) });
    delete ctx.quote;

    const outcome = await scoreFundamental(ctx);

    // Upside is a comparison. Without the near side of it there is no number,
    // and inventing a reference price is exactly the failure being guarded.
    expect(isUnavailable(outcome)).toBe(true);
  });

  it('reads a target below the price as bearish', async () => {
    const outcome = await scoreFundamental(
      equityContext({ analyst: estimates({ targetConsensus: 80 }) }),
    );

    if (isUnavailable(outcome)) throw new Error('expected a score');
    const upside = outcome.signals.find((s) => s.label.startsWith('Upside'));
    expect(upside?.direction).toBe('bearish');
    expect(upside?.value).toContain('-20.0%');
  });

  it('does not let the sell-side’s structural bullishness max out the score', async () => {
    const allBuys = await scoreFundamental(
      equityContext({ analyst: estimates({ strongBuy: 12, buy: 8, hold: 1, sell: 0 }) }),
    );
    const mixed = await scoreFundamental(
      equityContext({ analyst: estimates({ strongBuy: 1, buy: 2, hold: 8, sell: 6 }) }),
    );

    if (isUnavailable(allBuys) || isUnavailable(mixed)) throw new Error('expected scores');

    // An overwhelmingly positive book must still outrank a negative one...
    expect(allBuys.score).toBeGreaterThan(mixed.score);
    // ...but must not pin at the ceiling, or the factor becomes a proxy for how
    // many analysts cover the name.
    expect(allBuys.score).toBeLessThan(100);
  });

  it('ignores a rating distribution that is entirely empty', async () => {
    const outcome = await scoreFundamental(
      equityContext({ analyst: estimates({ strongBuy: 0, buy: 0, hold: 0, sell: 0 }) }),
    );

    // Zero of everything is "nobody covers this", not "a perfectly balanced book".
    expect(isUnavailable(outcome)).toBe(true);
  });
});

function scored(symbol: string, score: number, recommendation: Score['recommendation']): Score {
  return {
    ref: { symbol, market: 'NASDAQ', kind: 'equity' },
    score,
    recommendation,
    confidence: 70,
    breakdown: [],
    omitted: [],
    topReasons: [],
    sources: ['finnhub'],
    risk: { severity: 'low', drivers: [], caveats: [] },
    computedAt: new Date('2026-08-01T12:00:00Z'),
  };
}

describe('complete ranking', () => {
  const inputs: ScannerInput[] = [
    { name: 'Mid', score: scored('MID', 50, 'HOLD') },
    { name: 'Best', score: scored('BEST', 91, 'STRONG_BUY') },
    { name: 'Worst', score: scored('WORST', 8, 'STRONG_SELL') },
    { name: 'Good', score: scored('GOOD', 66, 'BUY') },
  ];

  it('orders every asset from strongest buy to strongest sell', () => {
    const result = scan(inputs, 4, 2);

    expect(result.ranked.map((o) => o.symbol)).toEqual(['BEST', 'GOOD', 'MID', 'WORST']);
  });

  it('is not truncated by the per-band limit', () => {
    // `limit` shortens the actionable lists; the full ranking is the whole point
    // of a scanner and must not inherit that cap.
    const result = scan(inputs, 4, 1);

    expect(result.buy).toHaveLength(1);
    expect(result.ranked).toHaveLength(4);
  });

  it('keeps low-confidence assets in the ranking they were excluded from acting on', () => {
    const thin = scored('THIN', 88, 'STRONG_BUY');
    thin.confidence = 10;

    const result = scan([...inputs, { name: 'Thin', score: thin }], 5, 5);

    expect(result.buy.map((o) => o.symbol)).not.toContain('THIN');
    // Present, and ranked on its score — dropping it would show a subset of the
    // universe as though it were all of it.
    expect(result.ranked.map((o) => o.symbol)).toContain('THIN');
    expect(result.ranked[0]?.symbol).toBe('BEST');
    expect(result.ranked[1]?.symbol).toBe('THIN');
  });
});

describe('potential move', () => {
  it('is derived from the plan target and reported signed', () => {
    const base = scored('UP', 80, 'BUY');
    const result = scan(
      [
        {
          name: 'Up',
          score: base,
          plan: {
            action: 'BUY',
            stance: 'long',
            confidence: 70,
            currentPrice: 100,
            priceSource: 'finnhub',
            priceAsOf: new Date('2026-08-01T12:00:00Z'),
            entry: { low: 98, high: 100, method: 'test', inputs: [] },
            target: { price: 125, method: 'test', inputs: [] },
            stop: { price: 90, method: 'test', inputs: [] },
            riskLevel: 'medium',
            riskReward: 2,
            riskRewardBelowTarget: false,
            missing: [],
            computedAt: new Date('2026-08-01T12:00:00Z'),
          },
        },
      ],
      1,
      1,
    );

    expect(result.buy[0]?.target).toBe(125);
    expect(result.buy[0]?.potentialPercent).toBeCloseTo(25, 10);
    expect(result.buy[0]?.riskLevel).toBe('medium');
  });

  it('is absent when no plan was produced, rather than zero', () => {
    const result = scan([{ name: 'No plan', score: scored('NP', 80, 'BUY') }], 1, 1);

    // A 0% potential and an unknown one render identically if this is not
    // undefined, and one of those is a real, actionable reading.
    expect(result.buy[0]?.potentialPercent).toBeUndefined();
    expect(result.buy[0]?.target).toBeUndefined();
  });
});
