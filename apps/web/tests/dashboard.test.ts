import { describe, expect, it } from 'vitest';

import { volumeRatioOf } from '@/lib/dashboard/trending';
import type { AssetScore, ScoreBreakdown, Signal } from '@/lib/analysis/types';

function signal(label: string, value: string, source = 'binance'): Signal {
  return { label, value, direction: 'neutral', weight: 0.2, source };
}

function scoreWith(signals: Signal[]): AssetScore {
  const breakdown: ScoreBreakdown[] = [
    {
      factor: 'technical',
      nominalWeight: 30,
      effectiveWeight: 30,
      score: 55,
      confidence: 0.8,
      signals,
    },
  ];

  return {
    ref: { symbol: 'BTC', market: 'CRYPTO', kind: 'crypto' },
    score: 55,
    recommendation: 'HOLD',
    confidence: 70,
    breakdown,
    omitted: [],
    topReasons: [],
    sources: ['binance'],
    risk: { severity: 'low', drivers: [], caveats: [] },
    computedAt: new Date(),
  };
}

describe('trending ranking', () => {
  it('reads the volume ratio from a cited signal and keeps its provenance', () => {
    const result = volumeRatioOf(scoreWith([signal('Volume vs 20-bar average', '2.4×')]));

    expect(result).toEqual({ ratio: 2.4, source: 'binance' });
  });

  it('returns undefined when no volume signal exists, so the asset is excluded', () => {
    const result = volumeRatioOf(scoreWith([signal('RSI(14)', '58.2')]));

    // Undefined rather than 0: an unmeasured ratio is not a low one, and ranking
    // it as zero would push assets we could not measure to the bottom of a list
    // as though we had measured them.
    expect(result).toBeUndefined();
  });

  it('returns undefined when the signal value carries no number', () => {
    const result = volumeRatioOf(scoreWith([signal('Volume vs 20-bar average', 'unavailable')]));

    expect(result).toBeUndefined();
  });
});
