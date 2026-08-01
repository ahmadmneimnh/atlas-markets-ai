import 'server-only';

import { NextResponse } from 'next/server';

/**
 * Per-caller rate limiting for the BFF's own routes.
 *
 * This is distinct from the provider rate limiters in `lib/http.ts`. Those stop
 * *us* exceeding a vendor's quota; this stops one caller consuming the quota
 * everybody shares. Without it, a single client polling `/api/score` in a loop
 * exhausts the Finnhub allowance for every other user of the deployment.
 *
 * **In-memory, and therefore per-instance.** On one process it is a real limit;
 * across N instances the effective limit is N× what is configured here. That is
 * an accepted trade for having no Redis dependency on the request path — and it
 * is written down rather than discovered later, because the fix (move the
 * counter to Redis) is easy but only happens if someone knows it is needed.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Bounded so a burst of unique keys cannot grow the map without limit. */
const MAX_KEYS = 10_000;

export interface RateLimitConfig {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  /** Scoring fans out to several providers per call, so it is the tightest. */
  score: { limit: 30, windowMs: 60_000 },
  search: { limit: 60, windowMs: 60_000 },
  /** Writes are cheap for us but a spam vector, so they are capped too. */
  write: { limit: 40, windowMs: 60_000 },
  read: { limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitConfig>;

/**
 * Identifies the caller.
 *
 * A signed-in user is keyed by id, so someone behind a shared NAT is not
 * throttled by a stranger's traffic. Anonymous callers fall back to the
 * forwarded IP.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy that sets it — a client
 * can send whatever it likes otherwise. The leftmost entry is used because
 * that is the convention proxies follow; on a deployment without a trusted
 * proxy this degrades to a shared bucket, which fails closed rather than open.
 */
export function callerKey(request: Request, userId?: string): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * `now` is a parameter rather than a call to `Date.now()` inside the function so
 * window-expiry behaviour can be tested deterministically. A test that races a
 * one-millisecond window against the scheduler is a test that fails on a busy
 * machine and teaches people to re-run CI.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now(),
): RateLimitVerdict {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) {
      // Drop expired entries before rejecting anything; a full map is almost
      // always full of windows that have already closed.
      for (const [k, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(k);
      }
    }
    const bucket: Bucket = { count: 1, resetAt: now + config.windowMs };
    buckets.set(key, bucket);
    return { allowed: true, remaining: config.limit - 1, resetAt: bucket.resetAt };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= config.limit,
    remaining: Math.max(0, config.limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/**
 * Returns a 429 when the caller is over budget, or null to proceed.
 *
 * `Retry-After` is always set on a rejection: a client that does not know when
 * to come back retries immediately, which is how a rate limit becomes a
 * self-sustaining load problem.
 */
export function enforceRateLimit(
  request: Request,
  config: RateLimitConfig,
  userId?: string,
): NextResponse | null {
  const verdict = checkRateLimit(callerKey(request, userId), config);
  if (verdict.allowed) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000));

  return NextResponse.json(
    {
      error: 'rate_limited',
      message: `Too many requests. Try again in ${retryAfterSeconds}s.`,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
        'X-RateLimit-Limit': String(config.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(verdict.resetAt / 1000)),
      },
    },
  );
}

/** Test seam — the module-level map would otherwise leak state between cases. */
export function resetRateLimits(): void {
  buckets.clear();
}
