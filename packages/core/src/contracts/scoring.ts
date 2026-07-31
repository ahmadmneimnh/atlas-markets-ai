import { z } from 'zod';

/**
 * The wire contract between the Next.js BFF, the BullMQ worker, and the Python
 * AI engine.
 *
 * Three properties are deliberate and load-bearing:
 *
 *  - **Zod schemas, not bare interfaces.** These cross a process boundary. A
 *    TypeScript interface guarantees nothing about what actually arrives over
 *    HTTP; `parse()` does. The Python service mirrors these in Pydantic
 *    (`services/ai-engine/app/schemas/scoring.py`) and the two are kept in sync
 *    through `CONTRACT_VERSION`.
 *
 *  - **Missing factors are represented, not defaulted.** `FactorOutcome` is a
 *    discriminated union of "scored" and "unavailable-with-reason". There is no
 *    shape in which a factor arrives without either a score or an explanation,
 *    so no consumer can silently read an absent factor as neutral.
 *
 *  - **Timestamps are ISO-8601 strings.** JSON has no date type; a `Date` on one
 *    side and a string on the other is the classic source of NaN-valued charts.
 */

/** Bumped whenever a schema here changes shape. Services refuse mismatched majors. */
export const CONTRACT_VERSION = '1.0.0' as const;

export const assetKindSchema = z.enum(['equity', 'crypto']);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetRefSchema = z.object({
  kind: assetKindSchema,
  /** Canonical, upper-cased ticker: `AAPL`, `BTC`. Not a provider-specific id. */
  symbol: z.string().min(1).max(24),
  name: z.string().optional(),
});
export type AssetRef = z.infer<typeof assetRefSchema>;

export const factorSchema = z.enum(['technical', 'fundamental', 'news', 'social', 'macro', 'risk']);
export type Factor = z.infer<typeof factorSchema>;

export const directionSchema = z.enum(['bullish', 'bearish', 'neutral']);
export type Direction = z.infer<typeof directionSchema>;

export const recommendationSchema = z.enum(['STRONG_SELL', 'SELL', 'HOLD', 'BUY', 'STRONG_BUY']);
export type Recommendation = z.infer<typeof recommendationSchema>;

/**
 * One piece of cited evidence. `source` is required at the type level: a signal
 * whose provenance is unknown cannot be displayed, so it cannot be constructed.
 */
export const signalSchema = z.object({
  label: z.string(),
  value: z.string(),
  direction: directionSchema,
  /** Contribution within its own factor, 0–1. */
  weight: z.number().min(0).max(1),
  /** Provider id the underlying datum came from, e.g. `finnhub`. */
  source: z.string().min(1),
});
export type Signal = z.infer<typeof signalSchema>;

export const factorScoredSchema = z.object({
  factor: factorSchema,
  status: z.literal('scored'),
  /** 0–100, where 50 means genuinely neutral evidence — never "unknown". */
  score: z.number().min(0).max(100),
  /** 0–1: how much evidence this factor actually had. */
  confidence: z.number().min(0).max(1),
  /** Weight from the product spec, before renormalization. */
  nominalWeight: z.number().min(0).max(1),
  /** Weight actually applied after unavailable factors were dropped. */
  effectiveWeight: z.number().min(0).max(1),
  signals: z.array(signalSchema),
});

export const factorUnavailableSchema = z.object({
  factor: factorSchema,
  status: z.literal('unavailable'),
  /** Shown to the user verbatim. "No provider configured", not "error". */
  reason: z.string().min(1),
});

export const factorOutcomeSchema = z.discriminatedUnion('status', [
  factorScoredSchema,
  factorUnavailableSchema,
]);
export type FactorOutcome = z.infer<typeof factorOutcomeSchema>;

/** POST /v1/score request body. */
export const scoreRequestSchema = z.object({
  contractVersion: z.string(),
  asset: assetRefSchema,
  /**
   * Pre-fetched market data, keyed by capability. The AI engine performs no
   * outbound provider calls of its own: rate limits, API keys and the circuit
   * breaker all live in one place (the BFF's provider layer), and an engine that
   * cannot fetch cannot invent.
   */
  inputs: z.record(z.string(), z.unknown()),
  /** ISO-8601. The instant the inputs describe, not the instant of the request. */
  asOf: z.string().datetime(),
});
export type ScoreRequest = z.infer<typeof scoreRequestSchema>;

/** 200 response from POST /v1/score. */
export const scoreResponseSchema = z.object({
  contractVersion: z.string(),
  asset: assetRefSchema,
  /** 0–100 composite. */
  score: z.number().min(0).max(100),
  recommendation: recommendationSchema,
  /** 0–100. Derived from coverage × evidence depth, independent of `score`. */
  confidence: z.number().min(0).max(100),
  factors: z.array(factorOutcomeSchema),
  /** Highest-weight signals across all factors — the "why" shown to the user. */
  topReasons: z.array(signalSchema),
  /** Distinct provider ids that contributed data. */
  sources: z.array(z.string()),
  /** Fraction of nominal weight that was actually scoreable, 0–1. */
  coverage: z.number().min(0).max(1),
  computedAt: z.string().datetime(),
  /** Model or ruleset identifier, so a stored score can be attributed later. */
  engineVersion: z.string(),
});
export type ScoreResponse = z.infer<typeof scoreResponseSchema>;

/**
 * 422 response. Returned when coverage falls below the engine's floor.
 *
 * This is a success path, not a failure: refusing to answer is the correct
 * output when the evidence is too thin, and it must be as structured and
 * as consumable as a score.
 */
export const insufficientDataSchema = z.object({
  contractVersion: z.string(),
  error: z.literal('insufficient_data'),
  asset: assetRefSchema,
  coverage: z.number().min(0).max(1),
  requiredCoverage: z.number().min(0).max(1),
  omitted: z.array(z.object({ factor: factorSchema, reason: z.string() })),
});
export type InsufficientData = z.infer<typeof insufficientDataSchema>;
