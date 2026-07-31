import type { AssetContext, FactorOutcome, FactorScorer } from '../types';

/**
 * Macro factor (nominal weight 10%).
 *
 * NOT YET IMPLEMENTED — reported as unavailable for the same reason as the social
 * factor (see social.ts): a placeholder "neutral" reading would contribute 10% of
 * every score from no evidence.
 *
 * To implement: add a provider for the FRED API (fed funds rate, CPI, 10Y/2Y curve,
 * unemployment) plus an economic-events calendar. The natural design is a single
 * market-wide macro regime computed once per cycle and cached, rather than per
 * asset — the yield curve does not vary by ticker. Per-asset modulation then comes
 * from sector/beta sensitivity to that regime.
 */
export const macroScorer: FactorScorer = {
  factor: 'macro',
  weight: 10,

  score(_ctx: AssetContext): FactorOutcome {
    return {
      factor: 'macro',
      unavailable: true,
      reason: 'no macroeconomic data provider configured (requires FRED or equivalent)',
    };
  },
};
