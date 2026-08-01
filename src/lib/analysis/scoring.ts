import type { AssetKind } from '@/lib/providers/types';
import { formatNumber } from '@/lib/format';
import type { Trend } from './indicators';
import { clamp } from './technical';
import type {
  Action, Confidence, Evidence, Horizon, ModuleId, ModuleResult, Probabilities,
  Verdict, WeightBreakdown,
} from './types';

/**
 * Recommendation scoring.
 *
 * Pure: it takes module results and returns a verdict. No I/O, no clock, no
 * randomness — the same modules always produce the same recommendation, which is
 * what makes the explanation on screen checkable.
 *
 * The design decision that matters most here: an unavailable module has its weight
 * redistributed across the modules that did report, and drags confidence down.
 * Scoring it as a neutral 50 would be the easy alternative and the wrong one — it
 * would let missing data quietly pull every asset toward Hold and present that as a
 * finding.
 */

export const DEFAULT_WEIGHTS: Record<ModuleId, number> = {
  technical: 0.4,
  fundamental: 0.3,
  market: 0.2,
  sentiment: 0.1,
};

export const MODULE_LABELS: Record<ModuleId, string> = {
  technical: 'Technical',
  fundamental: 'Fundamentals',
  market: 'Market conditions',
  sentiment: 'News sentiment',
};

/**
 * Minimum share of the nominal weighting that must be available before a verdict is
 * issued at all. Below this the engine reports Insufficient Data instead of a
 * confident-looking call built on one input.
 */
export const MIN_AVAILABLE_WEIGHT = 0.5;

export interface ScoreOutcome {
  conviction: number;
  probabilities: Probabilities;
  confidence: Confidence;
  confidenceScore: number;
  verdict: Verdict;
  action: Action;
  weights: WeightBreakdown[];
  /** Share of nominal weight that reported, 0–1. */
  availableWeight: number;
  /** 1 = every module agrees, 0 = maximum disagreement. */
  agreement: number;
  summary: string;
}

export function scoreModules(
  modules: ModuleResult[],
  weights: Record<ModuleId, number> = DEFAULT_WEIGHTS,
): ScoreOutcome | null {
  const available = modules.filter((m): m is Extract<ModuleResult, { available: true }> => m.available);

  const nominalTotal = modules.reduce((sum, m) => sum + (weights[m.id] ?? 0), 0);
  const availableTotal = available.reduce((sum, m) => sum + (weights[m.id] ?? 0), 0);
  const availableWeight = nominalTotal === 0 ? 0 : availableTotal / nominalTotal;

  const breakdown: WeightBreakdown[] = modules.map((m) => ({
    id: m.id,
    label: m.label,
    nominal: weights[m.id] ?? 0,
    applied: m.available && availableTotal > 0 ? (weights[m.id] ?? 0) / availableTotal : 0,
    score: m.available ? m.score : null,
  }));

  if (available.length === 0 || availableWeight < MIN_AVAILABLE_WEIGHT) return null;

  // Conviction: the weighted mean of the module scores.
  const conviction = available.reduce(
    (sum, m) => sum + m.score * ((weights[m.id] ?? 0) / availableTotal),
    0,
  );

  // Agreement: how far the modules sit from that mean, normalised so that a
  // 50-point spread counts as total disagreement.
  const dispersion = available.reduce(
    (sum, m) => sum + Math.abs(m.score - conviction) * ((weights[m.id] ?? 0) / availableTotal),
    0,
  );
  const agreement = clamp(1 - dispersion / 25, 0, 1);

  const completeness = available.reduce(
    (sum, m) => sum + m.completeness * ((weights[m.id] ?? 0) / availableTotal),
    0,
  );

  const confidenceScore = clamp(0.4 * availableWeight + 0.3 * completeness + 0.3 * agreement, 0, 1);
  const confidence: Confidence =
    confidenceScore >= 0.8 ? 'Very High'
    : confidenceScore >= 0.65 ? 'High'
    : confidenceScore >= 0.45 ? 'Medium'
    : 'Low';

  // Probabilities: each module votes as a soft triple, the triples are averaged by
  // applied weight, and low confidence shifts mass toward Hold.
  let buy = 0;
  let hold = 0;
  let sell = 0;
  for (const m of available) {
    const w = (weights[m.id] ?? 0) / availableTotal;
    const t = moduleTriple(m.score);
    buy += t.buy * w;
    hold += t.hold * w;
    sell += t.sell * w;
  }

  const c = confidenceScore;
  buy = buy * c;
  sell = sell * c;
  hold = 1 - buy - sell;

  const probabilities = toWholePercentages({ buy, hold, sell });

  const verdict = verdictFrom(conviction, probabilities);

  return {
    conviction,
    probabilities,
    confidence,
    confidenceScore,
    verdict,
    action: actionOf(verdict),
    weights: breakdown,
    availableWeight,
    agreement,
    summary: summarise(available, weights, availableTotal, conviction, verdict, availableWeight),
  };
}

/**
 * One module's contribution as a Buy/Hold/Sell triple.
 *
 * The exponent above 1 keeps mildly positive scores mostly in Hold: a module at 55
 * out of 100 is a lean, not a signal, and linear mapping would let four such leans
 * add up to a confident Buy.
 */
function moduleTriple(score: number): { buy: number; hold: number; sell: number } {
  const x = clamp((score - 50) / 50, -1, 1);
  const directional = Math.abs(x) ** 1.3 * 0.92;
  return x >= 0
    ? { buy: directional, hold: 1 - directional, sell: 0 }
    : { buy: 0, hold: 1 - directional, sell: directional };
}

/**
 * Rounds three fractions to integers that sum to exactly 100 (largest remainder).
 * Rounding each independently is what produces the 99% and 101% totals that make a
 * probability display look broken.
 */
export function toWholePercentages(p: { buy: number; hold: number; sell: number }): Probabilities {
  const total = p.buy + p.hold + p.sell;
  const normalised = total > 0 ? [p.buy / total, p.hold / total, p.sell / total] : [0, 1, 0];

  const scaled = normalised.map((v) => v * 100);
  const floors = scaled.map((v) => Math.floor(v));
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);

  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const out = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] = (out[i] as number) + 1;
    remainder--;
  }

  return { buy: out[0] as number, hold: out[1] as number, sell: out[2] as number };
}

function verdictFrom(conviction: number, p: Probabilities): Verdict {
  // Both the score and the distribution have to agree before the strong labels are
  // used: a high score with the mass still in Hold is a lean, not a conviction call.
  if (conviction >= 72 && p.buy >= 55) return 'STRONG_BUY';
  if (conviction >= 58) return 'BUY';
  if (conviction <= 28 && p.sell >= 55) return 'STRONG_SELL';
  if (conviction <= 42) return 'SELL';
  return 'HOLD';
}

export function actionOf(verdict: Verdict): Action {
  if (verdict === 'STRONG_BUY' || verdict === 'BUY') return 'BUY';
  if (verdict === 'STRONG_SELL' || verdict === 'SELL') return 'SELL';
  return 'HOLD';
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  STRONG_BUY: 'Strong Buy',
  BUY: 'Buy',
  HOLD: 'Hold',
  SELL: 'Sell',
  STRONG_SELL: 'Strong Sell',
};

function summarise(
  available: Extract<ModuleResult, { available: true }>[],
  weights: Record<ModuleId, number>,
  availableTotal: number,
  conviction: number,
  verdict: Verdict,
  availableWeight: number,
): string {
  const ranked = [...available].sort((a, b) => {
    const contribution = (m: typeof a) => Math.abs(m.score - 50) * ((weights[m.id] ?? 0) / availableTotal);
    return contribution(b) - contribution(a);
  });

  const supporting = ranked.filter((m) => (conviction >= 50 ? m.score >= 50 : m.score <= 50)).slice(0, 2);
  const opposing = ranked.filter((m) => (conviction >= 50 ? m.score < 50 : m.score > 50)).slice(0, 1);

  const name = (m: typeof ranked[number]) => `${m.label} (${formatNumber(m.score, 0)})`;

  let text = `${VERDICT_LABELS[verdict]} at a conviction of ${formatNumber(conviction, 0)}/100`;
  if (supporting.length > 0) text += `, driven by ${supporting.map(name).join(' and ')}`;
  if (opposing.length > 0) text += `, against ${opposing.map(name).join(' and ')}`;
  if (availableWeight < 1) {
    text += `. ${formatNumber(availableWeight * 100, 0)}% of the weighting was available; the rest was redistributed`;
  }
  return `${text}.`;
}

// ── Horizon ─────────────────────────────────────────────────────────────────────

export interface HorizonInput {
  kind: AssetKind;
  /** Annualised volatility, percent. */
  volatility: number | undefined;
  adx: number | undefined;
  trend: Trend | undefined;
  /** Fundamentals module score, when it was available. */
  fundamentalScore: number | null;
  aboveEma200: boolean | undefined;
}

/**
 * How long the evidence behind the verdict is likely to stay valid — which is what
 * an investment horizon actually is here, rather than a preference setting.
 */
export function deriveHorizon(input: HorizonInput): { horizon: Horizon; reason: string } {
  const { volatility, adx, trend, fundamentalScore, aboveEma200 } = input;

  if (volatility !== undefined && volatility >= 70) {
    return {
      horizon: 'Short',
      reason: `Annualised volatility of ${formatNumber(volatility, 0)}% means the setup can invalidate within days; this is a position to review weekly, not to hold passively.`,
    };
  }

  if (
    fundamentalScore !== null && fundamentalScore >= 60 &&
    (volatility === undefined || volatility < 40) &&
    aboveEma200 === true
  ) {
    return {
      horizon: 'Long',
      reason: `Fundamentals score ${formatNumber(fundamentalScore, 0)}/100 with volatility${volatility === undefined ? '' : ` of ${formatNumber(volatility, 0)}%`} and price above the 200-day EMA — the case rests on the business, which changes over quarters rather than weeks.`,
    };
  }

  if (adx !== undefined && adx >= 25 && (trend === 'strong_uptrend' || trend === 'strong_downtrend')) {
    return {
      horizon: 'Medium',
      reason: `ADX of ${formatNumber(adx, 0)} in a ${trend.replace('_', ' ')} — established trends of this strength have historically run for weeks to months, and that is the window this call covers.`,
    };
  }

  return {
    horizon: 'Medium',
    reason:
      'No single input dominates the timing: the evidence is drawn from daily bars and quarterly fundamentals, which put the useful review window at weeks to a few months.',
  };
}

// ── Evidence assembly ───────────────────────────────────────────────────────────

const IMPACT_RANK = { high: 0, medium: 1, low: 2 } as const;

/** Splits and orders module evidence for display: strongest first, warnings apart. */
export function collectEvidence(modules: ModuleResult[]): { reasons: Evidence[]; warnings: Evidence[] } {
  const all = modules.flatMap((m) => (m.available ? m.evidence : []));
  const byImpact = (a: Evidence, b: Evidence) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact];

  return {
    reasons: all.filter((e) => e.kind === 'reason').sort(byImpact),
    warnings: all.filter((e) => e.kind === 'warning').sort(byImpact),
  };
}
