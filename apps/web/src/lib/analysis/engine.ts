import type {
  AssetContext,
  AssetScore,
  FactorScorer,
  Recommendation,
  ScoreBreakdown,
  Signal,
  FactorOutcome,
} from './types';
import { isUnavailable } from './types';

import { technicalScorer } from './factors/technical';
import { fundamentalScorer } from './factors/fundamental';
import { newsScorer } from './factors/news';
import { socialScorer } from './factors/social';
import { macroScorer } from './factors/macro';
import { riskScorer } from './factors/risk';

/**
 * Composite scoring engine.
 *
 * Nominal weights come from the product spec (technical 30, fundamental 30,
 * news 15, social 10, macro 10, risk 5). Two rules govern how they are applied:
 *
 *  1. **Unavailable factors are dropped, not neutralised.** Their weight leaves the
 *     denominator entirely and the remaining weights are renormalized. Scoring an
 *     unknown factor as 50 would invent evidence and compress every asset toward
 *     the middle.
 *
 *  2. **Score and confidence are independent outputs.** Score says how good the
 *     asset looks; confidence says how much was actually known. They must not be
 *     blended into one number — a low-confidence 80 and a high-confidence 65 imply
 *     different actions, and averaging them erases that distinction.
 */

export const SCORERS: FactorScorer[] = [
  technicalScorer,
  fundamentalScorer,
  newsScorer,
  socialScorer,
  macroScorer,
  riskScorer,
];

/** Score bands per the product spec. */
export function toRecommendation(score: number): Recommendation {
  if (score <= 30) return 'STRONG_SELL';
  if (score <= 45) return 'SELL';
  if (score <= 55) return 'HOLD';
  if (score <= 70) return 'BUY';
  return 'STRONG_BUY';
}

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  STRONG_SELL: 'Strong Sell',
  SELL: 'Sell',
  HOLD: 'Hold',
  BUY: 'Buy',
  STRONG_BUY: 'Strong Buy',
};

/**
 * Minimum share of nominal weight that must be available for a score to be
 * meaningful at all. Below this the engine refuses to produce a recommendation
 * rather than extrapolating from one working factor.
 */
const MIN_COVERAGE = 0.25;

export class InsufficientDataError extends Error {
  constructor(
    readonly coverage: number,
    readonly omitted: { factor: string; reason: string }[],
  ) {
    super(
      `Insufficient data to score: only ${(coverage * 100).toFixed(0)}% of factor weight available ` +
        `(minimum ${MIN_COVERAGE * 100}%)`,
    );
    this.name = 'InsufficientDataError';
  }
}

export async function scoreAsset(
  ctx: AssetContext,
  scorers: FactorScorer[] = SCORERS,
): Promise<AssetScore> {
  const outcomes: FactorOutcome[] = await Promise.all(
    scorers.map(async (s) => {
      try {
        return await s.score(ctx);
      } catch (err) {
        // A thrown scorer must not take down the whole recommendation; it degrades
        // to an unavailable factor like any other missing input.
        return {
          factor: s.factor,
          unavailable: true as const,
          reason: `scorer error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }),
  );

  const available = outcomes.filter((o) => !isUnavailable(o));
  const omitted = outcomes
    .filter(isUnavailable)
    .map((o) => ({ factor: o.factor, reason: o.reason }));

  const nominalTotal = scorers.reduce((s, x) => s + x.weight, 0);
  const availableWeight = available.reduce((sum, o) => {
    const scorer = scorers.find((s) => s.factor === o.factor);
    return sum + (scorer?.weight ?? 0);
  }, 0);

  const coverage = nominalTotal === 0 ? 0 : availableWeight / nominalTotal;
  if (coverage < MIN_COVERAGE || available.length === 0) {
    throw new InsufficientDataError(coverage, omitted);
  }

  // Renormalize: each surviving factor's weight is rescaled so the applied weights
  // sum to 1 again.
  const breakdown: ScoreBreakdown[] = available.map((o) => {
    const scorer = scorers.find((s) => s.factor === o.factor);
    const nominal = scorer?.weight ?? 0;
    if (isUnavailable(o)) throw new Error('unreachable: filtered above');
    return {
      factor: o.factor,
      nominalWeight: nominal,
      effectiveWeight: availableWeight === 0 ? 0 : (nominal / availableWeight) * 100,
      score: o.score,
      confidence: o.confidence,
      signals: o.signals,
    };
  });

  const composite = breakdown.reduce((s, b) => s + b.score * (b.effectiveWeight / 100), 0);

  /**
   * Confidence combines two independent deficits:
   *  - coverage: how much of the intended weight ran at all
   *  - depth: the weighted mean of each factor's own confidence
   * Multiplying is right because both must hold — full coverage of factors that
   * each saw thin evidence is still a weak read.
   */
  const depth = breakdown.reduce((s, b) => s + b.confidence * (b.effectiveWeight / 100), 0);
  const confidence = Math.round(coverage * depth * 100);

  // Rank signals by their contribution to the final score: within-factor weight
  // scaled by the factor's effective weight.
  const topReasons: Signal[] = breakdown
    .flatMap((b) =>
      b.signals.map((sig) => ({ sig, impact: sig.weight * (b.effectiveWeight / 100) })),
    )
    .filter((x) => x.sig.direction !== 'neutral')
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 6)
    .map((x) => x.sig);

  const sources = [...new Set(breakdown.flatMap((b) => b.signals.map((s) => s.source)))];

  return {
    ref: ctx.ref,
    score: Math.round(composite * 10) / 10,
    recommendation: toRecommendation(composite),
    confidence,
    breakdown: breakdown.sort((a, b) => b.effectiveWeight - a.effectiveWeight),
    omitted,
    topReasons,
    sources,
    computedAt: new Date(),
  };
}
