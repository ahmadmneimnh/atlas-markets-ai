import { afterEach, describe, expect, it } from 'vitest';

import { callerKey, checkRateLimit, enforceRateLimit, resetRateLimits } from '@/lib/api/rate-limit';

afterEach(() => resetRateLimits());

const config = { limit: 3, windowMs: 60_000 };

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://atlas.test/api/score/crypto/BTC', { headers });
}

describe('rate limiting', () => {
  it('allows up to the limit and rejects beyond it', () => {
    const results = [1, 2, 3, 4].map(() => checkRateLimit('k', config));

    expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
    expect(results[3]?.allowed).toBe(false);
    expect(results[3]?.remaining).toBe(0);
  });

  it('keys signed-in users separately from their IP', () => {
    const anonymous = callerKey(req({ 'x-forwarded-for': '203.0.113.7' }));
    const signedIn = callerKey(req({ 'x-forwarded-for': '203.0.113.7' }), 'user_123');

    // Two colleagues behind one NAT must not throttle each other.
    expect(anonymous).not.toBe(signedIn);
    expect(signedIn).toBe('user:user_123');
  });

  it('takes the leftmost entry of x-forwarded-for', () => {
    const key = callerKey(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }));

    expect(key).toBe('ip:203.0.113.7');
  });

  it('always sets Retry-After on a rejection', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('ip:203.0.113.9', config);

    const response = enforceRateLimit(req({ 'x-forwarded-for': '203.0.113.9' }), config);

    expect(response?.status).toBe(429);
    // A client that does not know when to return retries immediately, which
    // turns a rate limit into a self-sustaining load problem.
    const retryAfter = Number(response?.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(response?.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('starts a fresh window once the old one expires', () => {
    const window = { limit: 1, windowMs: 60_000 };
    const t0 = 1_800_000_000_000;

    expect(checkRateLimit('k2', window, t0).allowed).toBe(true);
    expect(checkRateLimit('k2', window, t0 + 100).allowed).toBe(false);
    // One millisecond past the window boundary, the budget resets.
    expect(checkRateLimit('k2', window, t0 + 60_001).allowed).toBe(true);
  });
});
