import { z } from 'zod';
import { assetRefSchema } from './scoring';

/**
 * Queue and job definitions shared by the producer (the Next.js BFF) and the
 * consumer (`services/worker`).
 *
 * Producers and consumers are separate processes that deploy independently, so
 * the job name and its payload shape are the only thing keeping them compatible.
 * Both sides import from here; neither writes a string literal.
 */

/**
 * Redis key namespace for every Atlas queue, passed as BullMQ's `prefix`.
 *
 * It is not part of the queue name: BullMQ rejects a name containing `:`,
 * because it builds its own keys as `{prefix}:{queue}:{id}` and an embedded
 * colon would make those keys ambiguous. Namespacing through `prefix` is the
 * supported route, and it keeps a shared Redis instance readable —
 * `KEYS atlas:*` shows exactly this system's keys and nothing else.
 */
export const QUEUE_PREFIX = 'atlas' as const;

export const QUEUE = {
  /** Refreshes quotes/OHLCV for the tracked universe on a schedule. */
  marketData: 'market-data',
  /** Runs the AI engine and persists a ScoreSnapshot. */
  scoring: 'scoring',
  /** Evaluates user alert rules against the newest snapshot. */
  alerts: 'alerts',
  /** Fans an alert out to email / push / webhook channels. */
  notifications: 'notifications',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export const JOB = {
  refreshQuotes: 'refresh-quotes',
  refreshOhlcv: 'refresh-ohlcv',
  ingestNews: 'ingest-news',
  scoreAsset: 'score-asset',
  scoreUniverse: 'score-universe',
  evaluateAlerts: 'evaluate-alerts',
  deliverNotification: 'deliver-notification',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

/* ── Payloads ──────────────────────────────────────────────────────────────── */

export const refreshQuotesPayload = z.object({
  /**
   * Omitted means "the whole tracked universe" — which is what the scheduled
   * sweeps want. An empty array is rejected rather than treated as the same
   * thing: a caller that computed a list and got zero results almost certainly
   * hit a bug, and quietly promoting that to "refresh everything" turns a
   * no-op into a few hundred provider calls.
   */
  assets: z.array(assetRefSchema).min(1).max(200).optional(),
  /** Set by a manual admin refresh; bypasses the cache-freshness check. */
  force: z.boolean().default(false),
});

export const scoreAssetPayload = z.object({
  asset: assetRefSchema,
  /**
   * Correlates the job with the request that queued it across worker, engine and
   * BFF logs. Without it a slow score cannot be traced back to a user action.
   */
  traceId: z.string().optional(),
});

export const scoreUniversePayload = z.object({
  kind: z.enum(['equity', 'crypto', 'all']).default('all'),
});

export const evaluateAlertsPayload = z.object({
  /** Restrict evaluation to alerts on this asset; omit to sweep all of them. */
  asset: assetRefSchema.optional(),
});

export const deliverNotificationPayload = z.object({
  alertId: z.string(),
  channel: z.enum(['email', 'push', 'sms', 'webhook']),
});

/** Job name → payload schema. The worker validates against this before running. */
export const JOB_PAYLOADS = {
  [JOB.refreshQuotes]: refreshQuotesPayload,
  [JOB.refreshOhlcv]: refreshQuotesPayload,
  [JOB.ingestNews]: refreshQuotesPayload,
  [JOB.scoreAsset]: scoreAssetPayload,
  [JOB.scoreUniverse]: scoreUniversePayload,
  [JOB.evaluateAlerts]: evaluateAlertsPayload,
  [JOB.deliverNotification]: deliverNotificationPayload,
} as const;

export type JobPayload<N extends keyof typeof JOB_PAYLOADS> = z.infer<(typeof JOB_PAYLOADS)[N]>;

/**
 * Retry policy applied to every queue.
 *
 * Exponential backoff from 5s, five attempts. Market-data providers rate-limit
 * aggressively and a fixed-delay retry storm is how an account gets suspended;
 * BullMQ's `exponential` adds no jitter, so the worker's Redis connection sets
 * its own (see `services/worker/src/lib/redis.ts`).
 *
 * Completed jobs are kept briefly for the admin panel; failures are kept far
 * longer because a failure nobody can inspect is a failure that recurs.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 604_800 },
} as const;
