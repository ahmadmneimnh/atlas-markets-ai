import { describe, expect, it } from 'vitest';
import { evaluateRule, type AlertRule, type MarketSnapshot } from '@atlas/core';

const NOW = new Date('2026-07-01T12:00:00Z');

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'a1',
    type: 'PRICE_ABOVE',
    params: { threshold: 100 },
    cooldownMinutes: 60,
    enabled: true,
    ...over,
  };
}

describe('cooldown', () => {
  it('suppresses a true condition inside the cooldown window', () => {
    const decision = evaluateRule(
      rule({ lastFiredAt: new Date('2026-07-01T11:30:00Z') }),
      { price: 150 },
      NOW,
    );

    expect(decision.status).toBe('hold');
    expect(decision.reason).toMatch(/cooldown/i);
  });

  it('allows it once the window has passed', () => {
    const decision = evaluateRule(
      rule({ lastFiredAt: new Date('2026-07-01T10:30:00Z') }),
      { price: 150 },
      NOW,
    );

    expect(decision.status).toBe('fire');
  });
});

describe('undetermined is distinct from hold', () => {
  it('reports missing data rather than silently not firing', () => {
    const decision = evaluateRule(rule({ type: 'VOLUME_SPIKE', params: { multiple: 3 } }), {}, NOW);

    // Not 'hold'. A user whose volume data has been missing for a week would
    // otherwise believe the alert is armed when it is blind.
    expect(decision.status).toBe('undetermined');
    expect(decision.reason).toMatch(/volume ratio/i);
  });

  it('treats a rule with no threshold as undetermined, not as never-true', () => {
    const decision = evaluateRule(rule({ params: {} }), { price: 150 }, NOW);

    expect(decision.status).toBe('undetermined');
  });
});

describe('crossing rules need both sides', () => {
  it('does not fire an RSI alert on a level without a previous reading', () => {
    const decision = evaluateRule(
      rule({ type: 'RSI_ABOVE', params: { threshold: 70 } }),
      { rsi: 85 },
      NOW,
    );

    // Firing here would re-fire on every sweep for as long as RSI stayed high.
    expect(decision.status).toBe('undetermined');
    expect(decision.reason).toMatch(/crossing cannot be detected/i);
  });

  it('fires only on the crossing itself', () => {
    const crossing = evaluateRule(
      rule({ type: 'RSI_ABOVE', params: { threshold: 70 } }),
      { previousRsi: 68, rsi: 72 },
      NOW,
    );
    const alreadyAbove = evaluateRule(
      rule({ type: 'RSI_ABOVE', params: { threshold: 70 } }),
      { previousRsi: 74, rsi: 78 },
      NOW,
    );

    expect(crossing.status).toBe('fire');
    expect(alreadyAbove.status).toBe('hold');
  });

  it('detects a MACD zero-line crossing in the requested direction only', () => {
    const bullish = evaluateRule(
      rule({ type: 'MACD_CROSSOVER', params: { direction: 'bullish' } }),
      { previousMacdHistogram: -0.4, macdHistogram: 0.2 },
      NOW,
    );
    const wrongWay = evaluateRule(
      rule({ type: 'MACD_CROSSOVER', params: { direction: 'bullish' } }),
      { previousMacdHistogram: 0.4, macdHistogram: -0.2 },
      NOW,
    );

    expect(bullish.status).toBe('fire');
    expect(wrongWay.status).toBe('hold');
  });

  it('distinguishes a golden cross from a death cross', () => {
    const golden = evaluateRule(
      rule({ type: 'GOLDEN_CROSS', params: {} }),
      { previousFastMa: 9, previousSlowMa: 10, fastMa: 11, slowMa: 10 },
      NOW,
    );
    const death = evaluateRule(
      rule({ type: 'DEATH_CROSS', params: {} }),
      { previousFastMa: 11, previousSlowMa: 10, fastMa: 9, slowMa: 10 },
      NOW,
    );

    expect(golden.status).toBe('fire');
    expect(death.status).toBe('fire');
  });
});

describe('percent move', () => {
  it('fires in either direction', () => {
    const up = evaluateRule(
      rule({ type: 'PERCENT_MOVE', params: { percent: 5, window: '24h' } }),
      { changePercent: 6.2 },
      NOW,
    );
    const down = evaluateRule(
      rule({ type: 'PERCENT_MOVE', params: { percent: 5, window: '24h' } }),
      { changePercent: -7.1 },
      NOW,
    );

    expect(up.status).toBe('fire');
    expect(down.status).toBe('fire');
  });
});

describe('recommendation change', () => {
  it('respects the requested direction', () => {
    const upgradeWanted = {
      type: 'RECOMMENDATION_CHANGE' as const,
      params: { direction: 'upgrade' },
    };

    const upgraded = evaluateRule(
      rule(upgradeWanted),
      { previousRecommendation: 'HOLD', recommendation: 'BUY' },
      NOW,
    );
    const downgraded = evaluateRule(
      rule(upgradeWanted),
      { previousRecommendation: 'BUY', recommendation: 'HOLD' },
      NOW,
    );

    expect(upgraded.status).toBe('fire');
    expect(downgraded.status).toBe('hold');
  });

  it('is undetermined without a stored previous recommendation', () => {
    const decision = evaluateRule(
      rule({ type: 'RECOMMENDATION_CHANGE', params: {} }),
      { recommendation: 'BUY' },
      NOW,
    );

    expect(decision.status).toBe('undetermined');
  });
});

describe('breaking news', () => {
  it('applies the relevance floor', () => {
    const snapshot: MarketSnapshot = {
      freshNews: [
        { headline: 'Passing mention', relevance: 0.2, url: 'https://example.com/a' },
        { headline: 'Direct coverage', relevance: 0.9, url: 'https://example.com/b' },
      ],
    };

    const strict = evaluateRule(
      rule({ type: 'BREAKING_NEWS', params: { minRelevance: 0.8 } }),
      snapshot,
      NOW,
    );

    expect(strict.status).toBe('fire');
    expect(strict.reason).toMatch(/1 new headline/);
  });
});
