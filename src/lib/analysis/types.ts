import type { UnavailableDTO } from '@/lib/dto';
import type { AssetKind } from '@/lib/providers/types';

/**
 * Shared vocabulary for the analysis engine.
 *
 * Two shapes carry the whole design:
 *
 *  - `ModuleResult` is available-or-not, never partially faked. A module that cannot
 *    get its inputs says so with a reason, and the scorer redistributes its weight
 *    instead of scoring it as neutral — scoring a missing input as 50 would let
 *    absent data quietly pull every verdict toward Hold.
 *  - `Evidence` is always specific: it carries the measured value that produced it,
 *    so an explanation is a citation rather than a slogan.
 */

export type Direction = 'bullish' | 'bearish' | 'neutral';
export type Impact = 'high' | 'medium' | 'low';
export type ModuleId = 'technical' | 'fundamental' | 'market' | 'sentiment';

export interface Evidence {
  module: ModuleId;
  /** A reason supports the verdict; a warning argues against it. */
  kind: 'reason' | 'warning';
  /** Specific and measured, e.g. "RSI(14) at 28.4 — leaving oversold". */
  text: string;
  direction: Direction;
  impact: Impact;
}

export const reason = (
  module: ModuleId,
  text: string,
  direction: Direction,
  impact: Impact = 'medium',
): Evidence => ({ module, kind: 'reason', text, direction, impact });

export const warning = (
  module: ModuleId,
  text: string,
  impact: Impact = 'medium',
): Evidence => ({ module, kind: 'warning', text, direction: 'bearish', impact });

/** A metric worth showing on screen, with the units already applied. */
export interface Metric {
  label: string;
  /** Formatted for display; `null` means the provider did not supply it. */
  value: string | null;
  hint?: string;
  direction?: Direction;
}

export interface ModuleAvailable {
  id: ModuleId;
  label: string;
  available: true;
  /** 0–100, where 50 is neutral. */
  score: number;
  /**
   * Share of this module's own inputs that were present, 0–1. Drives confidence:
   * a fundamentals score built from two of eight fields is a real score, but not
   * one to bet the verdict on.
   */
  completeness: number;
  evidence: Evidence[];
  metrics: Metric[];
  /** Provider ids behind the inputs. */
  sources: string[];
}

export interface ModuleUnavailable {
  id: ModuleId;
  label: string;
  available: false;
  unavailable: UnavailableDTO;
}

export type ModuleResult = ModuleAvailable | ModuleUnavailable;

export const moduleUnavailable = (
  id: ModuleId,
  label: string,
  reasonCode: UnavailableDTO['reason'],
  detail?: string,
): ModuleUnavailable => ({
  id,
  label,
  available: false,
  unavailable: { reason: reasonCode, ...(detail ? { detail } : {}) },
});

// ── Verdict ─────────────────────────────────────────────────────────────────────

export type Action = 'BUY' | 'HOLD' | 'SELL';
export type Verdict = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
export type Confidence = 'Very High' | 'High' | 'Medium' | 'Low';
export type RiskLevel = 'Low Risk' | 'Medium Risk' | 'High Risk' | 'Very High Risk';
export type Horizon = 'Short' | 'Medium' | 'Long';

/** Integer percentages that always sum to exactly 100. */
export interface Probabilities {
  buy: number;
  hold: number;
  sell: number;
}

export interface WeightBreakdown {
  id: ModuleId;
  label: string;
  /** The nominal weight from the policy, 0–1. */
  nominal: number;
  /** The weight actually applied after redistributing unavailable modules, 0–1. */
  applied: number;
  score: number | null;
}

export interface RiskAssessment {
  level: RiskLevel;
  /** Why this level, in specific measured terms. */
  drivers: string[];
  annualisedVolatility: number | null;
  maxDrawdown1y: number | null;
  atrPercent: number | null;
}

export interface TradeLevels {
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  target: number;
  /** Reward divided by risk, from the numbers above. */
  rewardRisk: number;
  /** How each level was derived, for display next to it. */
  basis: string;
}

export interface Recommendation {
  symbol: string;
  kind: AssetKind;
  name: string;
  price: number;
  currency: string;

  verdict: Verdict;
  action: Action;
  /** 0–100 weighted score across available modules. */
  conviction: number;
  probabilities: Probabilities;
  confidence: Confidence;
  /** The 0–1 number behind `confidence`, kept for tests and tooltips. */
  confidenceScore: number;
  horizon: Horizon;
  horizonReason: string;

  /**
   * Absent when volatility could not be measured. There is deliberately no default
   * level: guessing one would put a risk label on screen that nothing measured.
   */
  risk: RiskAssessment | null;
  riskUnavailable: UnavailableDTO | null;
  /** Absent when volatility or price structure could not be measured. */
  levels: TradeLevels | null;
  levelsUnavailable: UnavailableDTO | null;

  modules: ModuleResult[];
  weights: WeightBreakdown[];
  reasons: Evidence[];
  warnings: Evidence[];
  /** One sentence naming the modules that actually drove the verdict. */
  summary: string;

  asOf: string;
  sources: string[];
}

/** Returned when too little of the weighting could be evaluated to say anything. */
export interface AnalysisUnavailable {
  symbol: string;
  kind: AssetKind;
  name: string;
  available: false;
  unavailable: UnavailableDTO;
  /** Which modules failed and why, so the UI can be specific. */
  modules: ModuleResult[];
}

export type AnalysisResult = ({ available: true } & Recommendation) | AnalysisUnavailable;
