import { z } from 'zod';

/**
 * Environment is validated once, at boot, and the process exits if it is wrong.
 *
 * The alternative — reading `process.env.X` at the point of use — means a typo in
 * a variable name surfaces three hours into a run as an inexplicable connection
 * failure inside a retry loop. Failing at startup is the whole point.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Required: BullMQ is Redis. There is no in-memory fallback and there should not be. */
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  /** Required once jobs persist anything. Absent, persistence-backed jobs refuse to register. */
  DATABASE_URL: z.string().url().optional(),

  /** Base URL of the Python scoring service. */
  AI_ENGINE_URL: z.string().url().default('http://localhost:8000'),

  /** Concurrent jobs per worker. Bounded by provider rate limits, not by CPU. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),

  /** Disable the repeatable schedulers — useful when running a one-off backfill. */
  WORKER_SCHEDULES_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    console.error(`[worker] invalid environment: ${issue.path.join('.')} — ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
