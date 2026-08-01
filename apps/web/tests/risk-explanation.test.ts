import { describe, expect, it } from 'vitest';

import { buildRiskExplanation } from '@/lib/analysis/risk-explanation';
import type { ScoreBreakdown, Signal } from '@/lib/analysis/types';

/**
 * The risk explanation is the one component where fluent output is the failure
 * mode. These tests assert the refusals and the citations, not the wording.
 */

function signal(label: string, value: string): Signal {
  return { label, value, direction: 'neutral', weight: 0.3, source: 'test' };
}

function riskBreakdown(signals: Signal[]): ScoreBreakdown[] {
  return [
    {
      factor: 'risk',
      nominalWeight: 5,
      effectiveWeight: 5,
      score: 50,
      confidence: 0.8,
      signals,
    },
  ];
}

describe('buildRiskExplanation', () => {
  it('cites the signal behind every measured risk statement', () => {
    const volatility = signal('Annualised volatility (30d)', '72.5%');
    const result = buildRiskExplanation(riskBreakdown([volatility]), [], 1, 90);

    expect(result.drivers.length).toBeGreaterThan(0);
    // Every driver must be checkable against a number the system holds.
    for (const driver of result.drivers) {
      expect(driver.signal).toBeDefined();
      expect(driver.signal?.source).toBe('test');
    }
    expect(result.drivers[0]?.text).toContain('72.5%');
  });

  it('escalates severity with the measurement rather than by default', () => {
    const calm = buildRiskExplanation(
      riskBreakdown([signal('Annualised volatility (30d)', '18%')]),
      [],
      1,
      90,
    );
    const wild = buildRiskExplanation(
      riskBreakdown([signal('Annualised volatility (30d)', '85%')]),
      [],
      1,
      90,
    );

    expect(calm.drivers[0]?.severity).toBe('low');
    expect(wild.drivers[0]?.severity).toBe('high');
  });

  it('says it does not know when no risk metric could be computed', () => {
    const result = buildRiskExplanation(riskBreakdown([]), [], 1, 90);

    expect(result.drivers).toHaveLength(0);
    expect(result.severity).toBe('high');
    expect(result.caveats.some((c) => /No risk metrics could be computed/.test(c.text))).toBe(true);
  });

  it('reports thin coverage as a caveat about the analysis, not about the asset', () => {
    const result = buildRiskExplanation(
      riskBreakdown([signal('Annualised volatility (30d)', '20%')]),
      [
        { factor: 'fundamental', reason: 'no provider' },
        { factor: 'news', reason: 'no articles' },
        { factor: 'social', reason: 'not implemented' },
      ],
      0.35,
      30,
    );

    const caveatText = result.caveats.map((c) => c.text).join(' ');
    expect(caveatText).toContain('3 of 6 factors');
    expect(caveatText).toContain('35%');
    // A caveat describes the analysis, so it carries no asset signal.
    expect(result.caveats.every((c) => c.signal === undefined)).toBe(true);
    expect(result.severity).toBe('high');
  });

  it('flags a heavily-weighted factor that has low internal confidence', () => {
    const breakdown: ScoreBreakdown[] = [
      {
        factor: 'news',
        nominalWeight: 15,
        effectiveWeight: 20,
        score: 70,
        confidence: 0.5,
        signals: [signal('Headline sentiment', 'positive')],
      },
    ];

    const result = buildRiskExplanation(breakdown, [], 1, 80);

    expect(result.caveats.some((c) => c.text.includes('news') && c.text.includes('20%'))).toBe(
      true,
    );
  });

  it('skips an unparseable signal value instead of reading it as zero risk', () => {
    const result = buildRiskExplanation(
      riskBreakdown([signal('Annualised volatility (30d)', 'unavailable')]),
      [],
      1,
      90,
    );

    // No driver was produced, and the absence is reported rather than being
    // silently treated as "volatility is fine".
    expect(result.drivers).toHaveLength(0);
    expect(result.caveats.some((c) => /No risk metrics/.test(c.text))).toBe(true);
  });
});
