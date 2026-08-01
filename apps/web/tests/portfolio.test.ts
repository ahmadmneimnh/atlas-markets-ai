import { describe, expect, it } from 'vitest';

import {
  diversification,
  portfolioRisk,
  summarise,
  valueHolding,
  type HoldingInput,
  type HoldingValuation,
} from '@/lib/portfolio/analytics';

const JAN = new Date('2026-01-01T00:00:00Z');
const JUL = new Date('2026-07-01T00:00:00Z');

function holding(over: Partial<HoldingInput> = {}): HoldingInput {
  return {
    symbol: 'AAPL',
    kind: 'equity',
    lots: [{ quantity: 10, pricePaid: 100, fees: 5, purchasedAt: JAN }],
    price: 120,
    ...over,
  };
}

function valuation(over: Partial<HoldingValuation> = {}): HoldingValuation {
  return {
    symbol: 'X',
    kind: 'equity',
    quantity: 1,
    averageCost: 100,
    costBasis: 100,
    price: 100,
    marketValue: 100,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    allocation: 1,
    heldDays: 0,
    ...over,
  };
}

describe('valueHolding', () => {
  it('includes fees in cost basis rather than treating them as a footnote', () => {
    const { valued } = valueHolding(holding(), JUL);

    // 10 × 100 + 5 in fees = 1005, so average cost is 100.50, not 100.
    expect(valued?.costBasis).toBe(1005);
    expect(valued?.averageCost).toBeCloseTo(100.5, 6);
    expect(valued?.unrealizedPnl).toBe(1200 - 1005);
  });

  it('reports an unpriced holding instead of valuing it at cost', () => {
    const { valued, unpriced } = valueHolding(holding({ price: undefined }), JUL);

    // Valuing at cost would report this position as exactly break-even, which is
    // indistinguishable from a real flat return.
    expect(valued).toBeUndefined();
    expect(unpriced?.reason).toMatch(/no configured provider/i);
    expect(unpriced?.costBasis).toBe(1005);
  });

  it('measures the holding period from the earliest open lot', () => {
    const { valued } = valueHolding(
      holding({
        lots: [
          { quantity: 5, pricePaid: 100, fees: 0, purchasedAt: new Date('2026-06-01T00:00:00Z') },
          { quantity: 5, pricePaid: 90, fees: 0, purchasedAt: JAN },
        ],
      }),
      JUL,
    );

    // 1 Jan → 1 Jul, not 1 Jun → 1 Jul. Holding-period tax rules key off the
    // earliest lot, which is exactly why lots are stored separately.
    expect(valued?.heldDays).toBe(181);
  });

  it('does not divide by zero on a zero-cost position', () => {
    const { valued } = valueHolding(
      holding({ lots: [{ quantity: 10, pricePaid: 0, fees: 0, purchasedAt: JAN }] }),
      JUL,
    );

    expect(valued?.unrealizedPnlPercent).toBe(0);
    expect(Number.isFinite(valued!.unrealizedPnlPercent)).toBe(true);
  });
});

describe('diversification', () => {
  it('scores concentration, not position count', () => {
    const even = diversification([
      valuation({ symbol: 'A', allocation: 0.25, marketValue: 25 }),
      valuation({ symbol: 'B', allocation: 0.25, marketValue: 25 }),
      valuation({ symbol: 'C', allocation: 0.25, marketValue: 25 }),
      valuation({ symbol: 'D', allocation: 0.25, marketValue: 25 }),
    ]);

    const lopsided = diversification([
      valuation({ symbol: 'A', allocation: 0.91, marketValue: 91 }),
      valuation({ symbol: 'B', allocation: 0.03, marketValue: 3 }),
      valuation({ symbol: 'C', allocation: 0.03, marketValue: 3 }),
      valuation({ symbol: 'D', allocation: 0.03, marketValue: 3 }),
    ]);

    // Same number of positions, radically different concentration.
    expect(even.positions).toBe(lopsided.positions);
    expect(even.score).toBeGreaterThan(lopsided.score * 2);
    expect(lopsided.notes.join(' ')).toMatch(/91% of the portfolio/);
  });

  it('penalises a single-sector book even when position count is high', () => {
    const spread = Array.from({ length: 8 }, (_, i) =>
      valuation({ symbol: `S${i}`, allocation: 0.125, marketValue: 12.5, sector: 'Technology' }),
    );

    const result = diversification(spread);

    expect(result.sectors).toBe(1);
    expect(result.notes.join(' ')).toMatch(/one sector/i);
    // Eight even positions would otherwise score 80; the sector penalty applies.
    expect(result.score).toBeLessThan(80);
  });

  it('says how many holdings lacked a sector rather than assuming one', () => {
    const result = diversification([
      valuation({ symbol: 'A', allocation: 0.5, marketValue: 50, sector: 'Energy' }),
      valuation({ symbol: 'B', allocation: 0.5, marketValue: 50 }),
    ]);

    expect(result.notes.join(' ')).toMatch(/1 holding had no sector classification/);
  });
});

describe('portfolioRisk', () => {
  it('excludes unscored holdings from the mean and reports coverage', () => {
    const result = portfolioRisk([
      valuation({ symbol: 'A', allocation: 0.5, marketValue: 50, riskScore: 80 }),
      valuation({ symbol: 'B', allocation: 0.5, marketValue: 50 }),
    ]);

    // 80, not 65. Assuming 50 for the unscored half would drag every portfolio
    // toward the middle and make an unscored book look moderate.
    expect(result.score).toBe(80);
    expect(result.coverage).toBeCloseTo(0.5, 6);
    expect(result.notes.join(' ')).toMatch(/50% of portfolio value/);
  });

  it('reports no score at all when nothing is scored', () => {
    const result = portfolioRisk([valuation({ symbol: 'A', allocation: 1, marketValue: 100 })]);

    expect(result.score).toBeUndefined();
    expect(result.coverage).toBe(0);
  });

  it('weights by value, not by position count', () => {
    const result = portfolioRisk([
      valuation({ symbol: 'BIG', allocation: 0.9, marketValue: 900, riskScore: 90 }),
      valuation({ symbol: 'SMALL', allocation: 0.1, marketValue: 100, riskScore: 10 }),
    ]);

    // Equal-weighting would give 50 and badly understate the book's exposure.
    expect(result.score).toBe(82);
  });
});

describe('summarise', () => {
  it('computes allocation over priced value only, and reports the coverage gap', () => {
    const summary = summarise(
      [holding({ symbol: 'AAPL', price: 120 }), holding({ symbol: 'GHOST', price: undefined })],
      JUL,
    );

    expect(summary.holdings).toHaveLength(1);
    expect(summary.unpriced).toHaveLength(1);
    // The single priced holding is 100% of the priced portfolio.
    expect(summary.holdings[0]?.allocation).toBe(1);
    // But only half the cost basis could be priced, and that is stated.
    expect(summary.pricedCoverage).toBeCloseTo(0.5, 6);
  });

  it('excludes unpriced cost from the return calculation', () => {
    const summary = summarise(
      [holding({ symbol: 'AAPL', price: 120 }), holding({ symbol: 'GHOST', price: undefined })],
      JUL,
    );

    // Return is (1200 - 1005) / 1005 on the priced holding alone. Including the
    // unpriced position's cost in the denominator would halve the reported
    // return for no reason a user could see.
    expect(summary.totalReturnPercent).toBeCloseTo(((1200 - 1005) / 1005) * 100, 6);
    expect(summary.totalCostBasis).toBe(2010);
  });
});
