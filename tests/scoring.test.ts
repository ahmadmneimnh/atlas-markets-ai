import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WEIGHTS, MIN_AVAILABLE_WEIGHT, actionOf, collectEvidence, deriveHorizon,
  scoreModules, toWholePercentages,
} from '@/lib/analysis/scoring';
import { moduleUnavailable, reason, warning, type ModuleId, type ModuleResult } from '@/lib/analysis/types';

/**
 * The scoring engine is the one place where every module's output becomes a number a
 * user might act on, so these tests pin the properties that must hold for any input:
 * probabilities that total 100, missing data that lowers confidence instead of
 * voting, and strong labels that need more than a high score.
 */

function mod(id: ModuleId, score: number, completeness = 1): ModuleResult {
  return {
    id,
    label: id,
    available: true,
    score,
    completeness,
    evidence: [],
    metrics: [],
    sources: ['test'],
  };
}

const missing = (id: ModuleId): ModuleResult => moduleUnavailable(id, id, 'no_provider_configured', 'not set up');

const allFour = (t: number, f: number, m: number, s: number) => [
  mod('technical', t), mod('fundamental', f), mod('market', m), mod('sentiment', s),
];

describe('probabilities', () => {
  it('always totals exactly 100, across the whole score space', () => {
    for (let t = 0; t <= 100; t += 7) {
      for (let f = 0; f <= 100; f += 11) {
        for (let m = 0; m <= 100; m += 13) {
          const outcome = scoreModules(allFour(t, f, m, 50));
          expect(outcome).not.toBeNull();
          const p = outcome!.probabilities;
          expect(p.buy + p.hold + p.sell).toBe(100);
          expect(p.buy).toBeGreaterThanOrEqual(0);
          expect(p.hold).toBeGreaterThanOrEqual(0);
          expect(p.sell).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('rounds by largest remainder rather than independently', () => {
    // Three equal thirds round to 33/33/33 = 99 if each is rounded on its own.
    const p = toWholePercentages({ buy: 1 / 3, hold: 1 / 3, sell: 1 / 3 });
    expect(p.buy + p.hold + p.sell).toBe(100);
    expect([p.buy, p.hold, p.sell].filter((v) => v === 34)).toHaveLength(1);
  });

  it('puts the mass on Buy when every module is bullish, and on Sell when every module is bearish', () => {
    const bullish = scoreModules(allFour(90, 85, 80, 75))!;
    expect(bullish.probabilities.buy).toBeGreaterThan(bullish.probabilities.sell);
    expect(bullish.probabilities.buy).toBeGreaterThan(50);

    const bearish = scoreModules(allFour(10, 15, 20, 25))!;
    expect(bearish.probabilities.sell).toBeGreaterThan(bearish.probabilities.buy);
    expect(bearish.probabilities.sell).toBeGreaterThan(50);
  });

  it('keeps mild leans in Hold rather than compounding them into a Buy', () => {
    const outcome = scoreModules(allFour(56, 55, 54, 55))!;
    expect(outcome.probabilities.hold).toBeGreaterThan(outcome.probabilities.buy);
    expect(outcome.verdict).toBe('HOLD');
  });

  it('gives both sides mass when modules disagree', () => {
    const outcome = scoreModules(allFour(90, 10, 85, 15))!;
    expect(outcome.probabilities.buy).toBeGreaterThan(0);
    expect(outcome.probabilities.sell).toBeGreaterThan(0);
    expect(outcome.agreement).toBeLessThan(0.5);
  });
});

describe('weight handling', () => {
  it('redistributes an unavailable module rather than scoring it as neutral', () => {
    const withSentiment = scoreModules([
      mod('technical', 90), mod('fundamental', 90), mod('market', 90), mod('sentiment', 50),
    ])!;
    const withoutSentiment = scoreModules([
      mod('technical', 90), mod('fundamental', 90), mod('market', 90), missing('sentiment'),
    ])!;

    // Treating the missing module as 50 would have dragged conviction down to the
    // first number; redistribution keeps it at the level the available modules say.
    expect(withSentiment.conviction).toBeLessThan(90);
    expect(withoutSentiment.conviction).toBeCloseTo(90, 5);
  });

  it('reports applied weights that sum to 1 across available modules only', () => {
    const outcome = scoreModules([
      mod('technical', 60), mod('fundamental', 60), missing('market'), missing('sentiment'),
    ])!;

    const applied = outcome.weights.reduce((sum, w) => sum + w.applied, 0);
    expect(applied).toBeCloseTo(1, 10);

    const technical = outcome.weights.find((w) => w.id === 'technical')!;
    expect(technical.applied).toBeCloseTo(0.4 / 0.7, 10);
    expect(outcome.weights.find((w) => w.id === 'market')!.applied).toBe(0);
    expect(outcome.weights.find((w) => w.id === 'market')!.score).toBeNull();
  });

  it('refuses to issue a verdict when too little of the weighting reported', () => {
    // Market alone is 20% of the nominal weighting.
    const outcome = scoreModules([
      missing('technical'), missing('fundamental'), mod('market', 80), missing('sentiment'),
    ]);
    expect(outcome).toBeNull();

    // Technical plus fundamentals is 70% and is enough.
    expect(scoreModules([
      mod('technical', 80), mod('fundamental', 70), missing('market'), missing('sentiment'),
    ])).not.toBeNull();
  });

  it('sets the availability threshold where the constant says', () => {
    const outcome = scoreModules([
      mod('technical', 80), missing('fundamental'), mod('market', 80), missing('sentiment'),
    ])!;
    expect(outcome.availableWeight).toBeCloseTo(0.6, 10);
    expect(outcome.availableWeight).toBeGreaterThanOrEqual(MIN_AVAILABLE_WEIGHT);
  });
});

describe('confidence', () => {
  it('falls when modules are missing', () => {
    const full = scoreModules(allFour(70, 70, 70, 70))!;
    const partial = scoreModules([
      mod('technical', 70), mod('fundamental', 70), missing('market'), missing('sentiment'),
    ])!;
    expect(partial.confidenceScore).toBeLessThan(full.confidenceScore);
  });

  it('falls when the available modules disagree', () => {
    const agreeing = scoreModules(allFour(70, 68, 72, 70))!;
    const conflicting = scoreModules(allFour(95, 20, 80, 30))!;
    expect(conflicting.confidenceScore).toBeLessThan(agreeing.confidenceScore);
  });

  it('falls when a module reports on partial inputs', () => {
    const complete = scoreModules([
      mod('technical', 70, 1), mod('fundamental', 70, 1), mod('market', 70, 1), mod('sentiment', 70, 1),
    ])!;
    const sparse = scoreModules([
      mod('technical', 70, 0.3), mod('fundamental', 70, 0.2), mod('market', 70, 0.3), mod('sentiment', 70, 0.2),
    ])!;
    expect(sparse.confidenceScore).toBeLessThan(complete.confidenceScore);
  });

  it('shifts probability mass toward Hold when confidence is low', () => {
    const confident = scoreModules(allFour(85, 85, 85, 85))!;
    const unsure = scoreModules([
      mod('technical', 85, 0.2), mod('fundamental', 85, 0.2), missing('market'), missing('sentiment'),
    ])!;
    expect(unsure.probabilities.hold).toBeGreaterThan(confident.probabilities.hold);
  });
});

describe('verdicts', () => {
  it('requires both a high score and a concentrated distribution for a strong label', () => {
    const strong = scoreModules(allFour(95, 92, 90, 88))!;
    expect(strong.verdict).toBe('STRONG_BUY');

    // High conviction reached over a heavily dissenting module: the score clears the
    // strong threshold but the distribution does not, so the label stays plain Buy.
    const split = scoreModules(allFour(100, 40, 100, 100))!;
    expect(split.conviction).toBeGreaterThan(72);
    expect(split.probabilities.buy).toBeLessThan(55);
    expect(split.verdict).toBe('BUY');
  });

  it('maps verdicts to actions', () => {
    expect(actionOf('STRONG_BUY')).toBe('BUY');
    expect(actionOf('BUY')).toBe('BUY');
    expect(actionOf('HOLD')).toBe('HOLD');
    expect(actionOf('SELL')).toBe('SELL');
    expect(actionOf('STRONG_SELL')).toBe('SELL');
  });

  it('names the modules that drove the call in its summary', () => {
    const outcome = scoreModules([
      mod('technical', 92), mod('fundamental', 35), mod('market', 80), missing('sentiment'),
    ])!;
    expect(outcome.summary).toContain('technical');
    expect(outcome.summary).toMatch(/against/);
    expect(outcome.summary).toMatch(/90% of the weighting was available/);
  });
});

describe('weights policy', () => {
  it('nominally weights technical 40, fundamentals 30, market 20, sentiment 10', () => {
    expect(DEFAULT_WEIGHTS).toEqual({ technical: 0.4, fundamental: 0.3, market: 0.2, sentiment: 0.1 });
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('horizon', () => {
  it('calls a very volatile asset short-horizon and says why', () => {
    const r = deriveHorizon({ kind: 'crypto', volatility: 95, adx: 30, trend: 'uptrend', fundamentalScore: 70, aboveEma200: true });
    expect(r.horizon).toBe('Short');
    expect(r.reason).toContain('95%');
  });

  it('calls a steady, fundamentally strong uptrend long-horizon', () => {
    const r = deriveHorizon({ kind: 'equity', volatility: 22, adx: 20, trend: 'uptrend', fundamentalScore: 72, aboveEma200: true });
    expect(r.horizon).toBe('Long');
  });

  it('defaults to medium and explains the default rather than asserting a trend', () => {
    const r = deriveHorizon({ kind: 'equity', volatility: undefined, adx: undefined, trend: undefined, fundamentalScore: null, aboveEma200: undefined });
    expect(r.horizon).toBe('Medium');
    expect(r.reason.length).toBeGreaterThan(30);
  });
});

describe('evidence assembly', () => {
  it('separates warnings from reasons and orders both by impact', () => {
    const modules: ModuleResult[] = [
      {
        ...mod('technical', 60),
        evidence: [
          reason('technical', 'low impact reason', 'bullish', 'low'),
          warning('technical', 'high impact warning', 'high'),
          reason('technical', 'high impact reason', 'bullish', 'high'),
          warning('technical', 'medium impact warning', 'medium'),
        ],
      } as ModuleResult,
      missing('market'),
    ];

    const { reasons, warnings } = collectEvidence(modules);
    expect(reasons.map((r) => r.impact)).toEqual(['high', 'low']);
    expect(warnings.map((w) => w.impact)).toEqual(['high', 'medium']);
    // Unavailable modules contribute nothing rather than a placeholder line.
    expect([...reasons, ...warnings].every((e) => e.module === 'technical')).toBe(true);
  });
});
