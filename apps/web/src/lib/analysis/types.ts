import type {
  AnalystEstimates,
  AssetRef,
  Quote,
  OhlcvSeries,
  Fundamentals,
  CryptoMetrics,
  NewsArticle,
} from '@/lib/providers/types';

export type Factor = 'technical' | 'fundamental' | 'news' | 'social' | 'macro' | 'risk';

export type Direction = 'bullish' | 'bearish' | 'neutral';

/**
 * A single piece of cited evidence. Every number that influenced a score must
 * appear as a Signal, including `source` — this is the audit trail that makes
 * "cite which data points influenced the decision" verifiable rather than asserted.
 */
export interface Signal {
  label: string;
  value: string;
  direction: Direction;
  /** Contribution within its factor, 0–1. Weights within a factor sum to ~1. */
  weight: number;
  /** Provider id the underlying datum came from. */
  source: string;
  /**
   * Which factor produced this signal.
   *
   * Optional because a scorer does not set it — it already knows, and requiring
   * every scorer to stamp its own name on every signal is a rule that gets
   * forgotten. The engine fills it in when flattening the breakdown, so any
   * signal that has travelled outside its `FactorResult` carries its origin.
   */
  factor?: Factor;
}

export interface FactorResult {
  factor: Factor;
  /** 0–100, where 50 is genuinely neutral evidence (not "unknown"). */
  score: number;
  /** 0–1: how much evidence was actually available for this factor. */
  confidence: number;
  signals: Signal[];
}

/** A factor that could not be scored. Distinct from a neutral score of 50. */
export interface FactorUnavailable {
  factor: Factor;
  unavailable: true;
  reason: string;
}

export type FactorOutcome = FactorResult | FactorUnavailable;

export const isUnavailable = (f: FactorOutcome): f is FactorUnavailable => 'unavailable' in f;

/** Everything a scorer may read. Assembled once per asset so providers are hit once. */
export interface AssetContext {
  ref: AssetRef;
  quote?: Quote;
  ohlcv?: OhlcvSeries;
  fundamentals?: Fundamentals;
  cryptoMetrics?: CryptoMetrics;
  news?: NewsArticle[];
  /**
   * Sell-side estimates. Equities only in practice, and absent whenever no
   * provider serves the `analyst` capability — the fundamental factor drops its
   * analyst contributions rather than assuming a neutral consensus.
   */
  analyst?: AnalystEstimates;
}

export interface FactorScorer {
  readonly factor: Factor;
  /** Nominal weight from the product spec. Renormalized when factors are missing. */
  readonly weight: number;
  score(ctx: AssetContext): FactorOutcome | Promise<FactorOutcome>;
}

export type Recommendation = 'STRONG_SELL' | 'SELL' | 'HOLD' | 'BUY' | 'STRONG_BUY';

export interface ScoreBreakdown {
  factor: Factor;
  /** Nominal weight before renormalization. */
  nominalWeight: number;
  /** Weight actually applied, after dropping unavailable factors. */
  effectiveWeight: number;
  score: number;
  confidence: number;
  signals: Signal[];
}

/**
 * One statement about risk, tied to the evidence it came from.
 *
 * `signal` is present for measured risk and absent for a caveat about the
 * analysis itself — the two are different claims and the UI renders them
 * differently.
 */
export interface RiskNote {
  severity: 'low' | 'medium' | 'high';
  text: string;
  signal?: Signal;
}

export interface RiskAssessment {
  severity: 'low' | 'medium' | 'high';
  /** Measured properties of the asset: volatility, drawdown, ATR. */
  drivers: RiskNote[];
  /** Limits of this analysis: missing factors, thin coverage, weak classifiers. */
  caveats: RiskNote[];
}

export interface AssetScore {
  ref: AssetRef;
  score: number;
  recommendation: Recommendation;
  /** 0–100. Reflects both coverage (how many factors ran) and within-factor evidence. */
  confidence: number;
  breakdown: ScoreBreakdown[];
  /** Factors that could not be scored, with the reason. Surfaced in the UI. */
  omitted: { factor: Factor; reason: string }[];
  /** Highest-weight signals across all factors — the "why" shown to the user. */
  topReasons: Signal[];
  /** Distinct provider ids that contributed data. */
  sources: string[];
  /**
   * Required, not optional. A recommendation without a stated risk is the
   * failure mode this product exists to avoid, so the type makes it
   * unconstructible rather than trusting every call site to remember.
   */
  risk: RiskAssessment;
  computedAt: Date;
}
