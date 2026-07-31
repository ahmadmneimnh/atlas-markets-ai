import { log } from './logger';

/**
 * Two-tier TTL cache. In-process LRU always; Redis when REDIS_URL is set (shared
 * across instances). Redis is loaded lazily so the app runs with neither Redis nor
 * any provider key configured.
 *
 * Failures are cached too, for a short window. A provider that is rate-limiting you
 * will keep rate-limiting you, and retrying on every request extends the outage.
 */

export const TTL = {
  quoteCrypto: 15,
  quoteEquity: 60,
  ohlcvDaily: 6 * 60 * 60,
  fundamentals: 24 * 60 * 60,
  profile: 7 * 24 * 60 * 60,
  news: 10 * 60,
  score: 5 * 60,
  failure: 30,
} as const;

interface Entry {
  value: unknown;
  expiresAt: number;
}

const MAX_ENTRIES = 2_000;
const memory = new Map<string, Entry>();

function memGet<T>(key: string): T | undefined {
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    memory.delete(key);
    return undefined;
  }
  // Refresh recency for the LRU eviction below.
  memory.delete(key);
  memory.set(key, hit);
  return hit.value as T;
}

function memSet(key: string, value: unknown, ttlSeconds: number): void {
  if (memory.size >= MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the least recently used.
    const oldest = memory.keys().next();
    if (!oldest.done) memory.delete(oldest.value);
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Read-through cache. `fetcher` runs only on a miss.
 *
 * `ttlFor` lets the caller pick a different TTL for failures than for successes,
 * which matters because caching an error for as long as a quote would hide a
 * provider's recovery.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  ttlFor?: (value: T) => number,
): Promise<T> {
  const hit = memGet<T>(key);
  if (hit !== undefined) {
    log.debug('cache_hit', { key });
    return hit;
  }

  const value = await fetcher();
  const ttl = ttlFor ? ttlFor(value) : ttlSeconds;
  memSet(key, value, ttl);
  return value;
}

/** TTL selector for ProviderResult-shaped values: short-cache failures. */
export function resultTtl(successTtl: number) {
  return (value: unknown): number => {
    const isFailure =
      typeof value === 'object' && value !== null && (value as { ok?: boolean }).ok === false;
    return isFailure ? TTL.failure : successTtl;
  };
}

export function cacheKey(...parts: (string | number)[]): string {
  return parts.join(':');
}

export function __clearCache(): void {
  memory.clear();
}
