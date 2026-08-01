import { log, scrubUrl } from './logger';

/**
 * Shared HTTP client for provider adapters: timeout, bounded retry with jittered
 * backoff, per-provider token-bucket rate limiting, and a circuit breaker.
 *
 * Rate limits are per-provider rather than global on purpose. Free tiers differ by
 * orders of magnitude (Alpha Vantage allows 25 requests/day; Binance's public
 * endpoints allow ~1200/minute). A single shared limiter would either throttle the
 * generous provider into uselessness or burn the strict provider's daily quota in
 * seconds.
 */

export class HttpError extends Error {
  readonly url: string;

  constructor(
    readonly status: number,
    readonly body: string,
    url: string,
  ) {
    // Sanitize at construction: most vendors authenticate by query parameter, and
    // this error's message and `url` both travel onward into logs, the provider
    // health view, and occasionally an API response body. Scrubbing here means
    // there is no path on which the raw credential can escape.
    const safe = scrubUrl(url);
    super(`HTTP ${status} for ${safe}`);
    this.name = 'HttpError';
    this.url = safe;
  }
}

export class RateLimitedError extends Error {
  constructor(readonly provider: string) {
    super(`Local rate limit reached for provider "${provider}"`);
    this.name = 'RateLimitedError';
  }
}

export class CircuitOpenError extends Error {
  constructor(readonly provider: string) {
    super(`Circuit breaker open for provider "${provider}"`);
    this.name = 'CircuitOpenError';
  }
}

// ── Token bucket ────────────────────────────────────────────────────────────────

interface Bucket {
  tokens: number;
  capacity: number;
  refillPerMs: number;
  last: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimit {
  /** Requests allowed per window. */
  requests: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

function takeToken(provider: string, limit: RateLimit): boolean {
  const now = Date.now();
  let b = buckets.get(provider);
  if (!b) {
    b = {
      tokens: limit.requests,
      capacity: limit.requests,
      refillPerMs: limit.requests / limit.windowMs,
      last: now,
    };
    buckets.set(provider, b);
  }
  // Continuous refill: avoids the thundering herd that a fixed-window reset causes.
  const elapsed = now - b.last;
  b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.refillPerMs);
  b.last = now;

  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// ── Circuit breaker ─────────────────────────────────────────────────────────────

interface Circuit {
  failures: number;
  openedAt: number | null;
}

const circuits = new Map<string, Circuit>();
const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 60_000;

function circuitFor(provider: string): Circuit {
  let c = circuits.get(provider);
  if (!c) {
    c = { failures: 0, openedAt: null };
    circuits.set(provider, c);
  }
  return c;
}

function isCircuitOpen(provider: string): boolean {
  const c = circuitFor(provider);
  if (c.openedAt === null) return false;
  if (Date.now() - c.openedAt > OPEN_DURATION_MS) {
    // Half-open: allow the next request through to probe recovery.
    c.openedAt = null;
    c.failures = 0;
    return false;
  }
  return true;
}

function recordSuccess(provider: string): void {
  const c = circuitFor(provider);
  c.failures = 0;
  c.openedAt = null;
}

function recordFailure(provider: string): void {
  const c = circuitFor(provider);
  c.failures += 1;
  if (c.failures >= FAILURE_THRESHOLD && c.openedAt === null) {
    c.openedAt = Date.now();
    log.warn('circuit_opened', { provider, failures: c.failures });
  }
}

// ── Request ─────────────────────────────────────────────────────────────────────

export interface FetchOptions {
  provider: string;
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  rateLimit?: RateLimit;
}

/** Statuses worth retrying: transient server faults and upstream rate limiting. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

function backoffMs(attempt: number): number {
  const base = Math.min(8_000, 300 * 2 ** attempt);
  // Full jitter — synchronized retries from multiple instances are what turn a
  // brief upstream blip into a sustained outage.
  return Math.random() * base;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T>(opts: FetchOptions): Promise<T> {
  return request<T>(opts, 'application/json', (res) => res.json() as Promise<T>);
}

/**
 * Same retry, rate-limit and circuit-breaker path as `fetchJson`, for endpoints
 * that answer with something other than JSON.
 *
 * Shares the machinery rather than reimplementing it: a provider that bypassed
 * the circuit breaker would keep hammering a dead upstream while every other
 * provider had backed off, which is the failure mode the breaker exists for.
 */
export async function fetchText(opts: FetchOptions): Promise<string> {
  return request<string>(opts, 'text/plain, text/csv, */*', (res) => res.text());
}

async function request<T>(
  opts: FetchOptions,
  accept: string,
  parse: (res: Response) => Promise<T>,
): Promise<T> {
  const { provider, url, headers = {}, timeoutMs = 8_000, retries = 2, rateLimit } = opts;

  if (isCircuitOpen(provider)) throw new CircuitOpenError(provider);
  if (rateLimit && !takeToken(provider, rateLimit)) throw new RateLimitedError(provider);

  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const res = await fetch(url, {
        headers: { accept, ...headers },
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new HttpError(res.status, body.slice(0, 500), url);
        if (isRetryable(res.status) && attempt < retries) {
          lastErr = err;
          await sleep(backoffMs(attempt));
          continue;
        }
        recordFailure(provider);
        throw err;
      }

      const body = await parse(res);
      recordSuccess(provider);
      log.debug('provider_call', { provider, ms: Date.now() - started, attempt });
      return body;
    } catch (err) {
      lastErr = err;
      // A caller-thrown HttpError has already been accounted for above.
      if (err instanceof HttpError) throw err;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      recordFailure(provider);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Test/ops helper — clears limiter and breaker state. */
export function __resetHttpState(): void {
  buckets.clear();
  circuits.clear();
}
