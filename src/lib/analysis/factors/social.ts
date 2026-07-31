import type { AssetContext, FactorOutcome, FactorScorer } from '../types';

/**
 * Social sentiment factor (nominal weight 10%).
 *
 * NOT YET IMPLEMENTED — and it reports that honestly rather than returning a
 * neutral 50.
 *
 * Reddit, X and StockTwits all require authenticated API access that this build
 * does not have configured. The choice here is between:
 *
 *   (a) returning 50 ("neutral"), which silently contributes 10% of every score
 *       from no evidence whatsoever, or
 *   (b) returning unavailable, which removes 10% from the denominator and tells
 *       the user this factor is missing.
 *
 * (a) is a form of fabrication: it manufactures a number no data supports, and it
 * drags every asset toward the middle so that "genuinely average" and "unknown"
 * become indistinguishable. The engine is built for (b).
 *
 * To implement: add a provider exposing a `social` capability (Reddit OAuth app,
 * StockTwits streaming API, X API v2 recent-search), then replace the body below
 * with the same Contribution pattern used in technical.ts. The AssetContext gains
 * a `social` field; nothing else in the engine changes.
 */
export const socialScorer: FactorScorer = {
  factor: 'social',
  weight: 10,

  score(_ctx: AssetContext): FactorOutcome {
    return {
      factor: 'social',
      unavailable: true,
      reason: 'no social data provider configured (requires Reddit / X / StockTwits credentials)',
    };
  },
};
