import { describe, it, expect } from 'vitest';
import { scoreAsset, toRecommendation, InsufficientDataError } from '@/lib/analysis/engine';
import type { AssetContext, FactorScorer, FactorOutcome } from '@/lib/analysis/types';
import type { AssetRef } from '@/lib/providers/types';

const ref: AssetRef = { symbol: 'TEST', market: 'NASDAQ', kind: 'equity' };
const ctx: AssetContext = { ref };

/** A scorer that always returns a fixed score. */
function fixed(
  factor: FactorScorer['factor'],
  weight: number,
  score: number,
  confidence = 1,
): FactorScorer {
  return {
    factor,
    weight,
    score: (): FactorOutcome => ({
      factor,
      score,
      confidence,
      signals: [
        {
          label: `${factor} signal`,
          value: String(score),
          direction: 'bullish',
          weight: 1,
          source: 'test',
        },
      ],
    }),
  };
}

function missing(factor: FactorScorer['factor'], weight: number): FactorScorer {
  return {
    factor,
    weight,
    score: (): FactorOutcome => ({ factor, unavailable: true, reason: 'test: no data' }),
  };
}

describe('recommendation bands', () => {
  it('maps scores to the bands defined in the spec', () => {
    expect(toRecommendation(0)).toBe('STRONG_SELL');
    expect(toRecommendation(30)).toBe('STRONG_SELL');
    expect(toRecommendation(31)).toBe('SELL');
    expect(toRecommendation(45)).toBe('SELL');
    expect(toRecommendation(46)).toBe('HOLD');
    expect(toRecommendation(55)).toBe('HOLD');
    expect(toRecommendation(56)).toBe('BUY');
    expect(toRecommendation(70)).toBe('BUY');
    expect(toRecommendation(71)).toBe('STRONG_BUY');
    expect(toRecommendation(100)).toBe('STRONG_BUY');
  });
});

describe('weighting', () => {
  it('computes a weighted mean when every factor is available', () => {
    const scorers = [
      fixed('technical', 30, 80),
      fixed('fundamental', 30, 60),
      fixed('news', 40, 50),
    ];
    // 0.3*80 + 0.3*60 + 0.4*50 = 24 + 18 + 20 = 62
    return scoreAsset(ctx, scorers).then((r) => {
      expect(r.score).toBeCloseTo(62, 5);
      expect(r.recommendation).toBe('BUY');
    });
  });

  it('renormalizes weight away from a missing factor instead of scoring it neutral', async () => {
    // technical 80 (w30), fundamental 80 (w30), social MISSING (w40).
    // Renormalized: both survivors carry 50% → score 80.
    // If the missing factor were treated as neutral 50 the score would be 68.
    const scorers = [
      fixed('technical', 30, 80),
      fixed('fundamental', 30, 80),
      missing('social', 40),
    ];
    const r = await scoreAsset(ctx, scorers);

    expect(r.score).toBeCloseTo(80, 5);
    expect(r.score).not.toBeCloseTo(68, 1); // the neutral-fill answer
    expect(r.omitted).toHaveLength(1);
    expect(r.omitted[0]!.factor).toBe('social');
  });

  it('reports effective weights that sum to 100 after renormalization', async () => {
    const scorers = [
      fixed('technical', 30, 70),
      fixed('fundamental', 30, 40),
      missing('macro', 10),
      missing('social', 10),
    ];
    const r = await scoreAsset(ctx, scorers);

    const total = r.breakdown.reduce((s, b) => s + b.effectiveWeight, 0);
    expect(total).toBeCloseTo(100, 5);
    // Two equal-weight survivors split evenly.
    expect(r.breakdown[0]!.effectiveWeight).toBeCloseTo(50, 5);
  });

  it('preserves the relative ratio of surviving weights', async () => {
    // technical(30) and risk(5) survive → 6:1 ratio → 85.71% / 14.29%.
    const scorers = [fixed('technical', 30, 100), fixed('risk', 5, 0), missing('fundamental', 30)];
    const r = await scoreAsset(ctx, scorers);

    // `score` is rounded to one decimal for display; `effectiveWeight` is not.
    expect(r.score).toBeCloseTo((30 / 35) * 100, 1);
    const technical = r.breakdown.find((b) => b.factor === 'technical')!;
    expect(technical.effectiveWeight).toBeCloseTo((30 / 35) * 100, 4);
  });
});

describe('confidence', () => {
  it('is independent of score', async () => {
    // Same score, different evidence depth.
    const strong = await scoreAsset(ctx, [
      fixed('technical', 30, 80, 1.0),
      fixed('fundamental', 30, 80, 1.0),
    ]);
    const weak = await scoreAsset(ctx, [
      fixed('technical', 30, 80, 0.3),
      fixed('fundamental', 30, 80, 0.3),
    ]);

    expect(strong.score).toBeCloseTo(weak.score, 5);
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
  });

  it('falls when factor coverage falls, even at full per-factor confidence', async () => {
    const full = await scoreAsset(ctx, [fixed('technical', 30, 70), fixed('fundamental', 30, 70)]);
    const partial = await scoreAsset(ctx, [fixed('technical', 30, 70), missing('fundamental', 30)]);

    expect(partial.confidence).toBeLessThan(full.confidence);
  });

  it('is bounded to 0-100', async () => {
    const r = await scoreAsset(ctx, [fixed('technical', 30, 50, 1)]);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(100);
  });
});

describe('refusal to guess', () => {
  it('throws rather than scoring when coverage is below the floor', async () => {
    // Only risk (weight 5 of 105) survives — under the 25% floor.
    const scorers = [
      fixed('risk', 5, 90),
      missing('technical', 30),
      missing('fundamental', 30),
      missing('news', 15),
      missing('social', 10),
      missing('macro', 10),
    ];
    await expect(scoreAsset(ctx, scorers)).rejects.toThrow(InsufficientDataError);
  });

  it('throws when no factor is available at all', async () => {
    await expect(scoreAsset(ctx, [missing('technical', 30)])).rejects.toThrow(
      InsufficientDataError,
    );
  });

  it('surfaces the omission reasons on the error', async () => {
    try {
      await scoreAsset(ctx, [missing('technical', 30), missing('fundamental', 30)]);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientDataError);
      expect((e as InsufficientDataError).omitted).toHaveLength(2);
    }
  });
});

describe('resilience', () => {
  it('degrades a throwing scorer to an unavailable factor', async () => {
    const exploding: FactorScorer = {
      factor: 'news',
      weight: 15,
      score: () => {
        throw new Error('provider exploded');
      },
    };
    const r = await scoreAsset(ctx, [
      fixed('technical', 30, 70),
      fixed('fundamental', 30, 70),
      exploding,
    ]);

    expect(r.score).toBeCloseTo(70, 5);
    expect(r.omitted.find((o) => o.factor === 'news')?.reason).toContain('provider exploded');
  });
});

describe('explanation', () => {
  it('cites sources and ranks reasons by contribution', async () => {
    const scorers = [
      fixed('technical', 30, 85),
      fixed('fundamental', 30, 75),
      fixed('risk', 5, 60),
    ];
    const r = await scoreAsset(ctx, scorers);

    expect(r.sources).toContain('test');
    expect(r.topReasons.length).toBeGreaterThan(0);
    // Every cited reason carries a provider attribution.
    for (const reason of r.topReasons) expect(reason.source).toBeTruthy();
  });
});
