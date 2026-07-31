import { HttpError, RateLimitedError, CircuitOpenError } from '@/lib/http';
import { log } from '@/lib/logger';
import type { Unavailable } from './types';
import { unavailable } from './types';

/**
 * Maps a thrown transport error to an `Unavailable` reason.
 *
 * Centralised so every adapter classifies failures identically — otherwise the
 * admin panel's provider health view reports the same outage under different
 * reasons depending on which vendor hit it.
 */
/**
 * Framework control-flow signals that must propagate rather than be classified.
 *
 * Next implements `notFound()`, `redirect()` and the static-generation bailout by
 * throwing tagged errors. An adapter's catch-all sits directly in that path, so
 * swallowing one converts a control-flow signal into a fake "provider is down" —
 * which is both a wrong diagnosis and a broken redirect.
 */
function isFrameworkControlFlow(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const digest = (e as { digest?: unknown }).digest;
  if (typeof digest !== 'string') return false;
  return (
    digest === 'DYNAMIC_SERVER_USAGE' ||
    digest === 'NEXT_NOT_FOUND' ||
    digest.startsWith('NEXT_REDIRECT')
  );
}

export function classifyError(e: unknown): Unavailable {
  if (isFrameworkControlFlow(e)) throw e;

  if (e instanceof RateLimitedError) return unavailable('rate_limited', 'local quota exhausted');
  if (e instanceof CircuitOpenError) return unavailable('circuit_open', 'provider circuit open');

  if (e instanceof HttpError) {
    if (e.status === 429) return unavailable('rate_limited', 'upstream 429');
    if (e.status === 404) return unavailable('not_found', 'upstream 404');
    if (e.status === 401 || e.status === 403) {
      // Distinct from a missing key: the key exists but was rejected. Worth a warn,
      // because it usually means an expired or wrong-tier credential.
      log.warn('provider_auth_rejected', { status: e.status, url: e.url });
      return unavailable('upstream_error', `auth rejected (${e.status})`);
    }
    return unavailable('upstream_error', `http ${e.status}`);
  }

  if (e instanceof Error && e.name === 'AbortError')
    return unavailable('timeout', 'request timed out');

  log.error('provider_unexpected_error', { error: e instanceof Error ? e.message : String(e) });
  return unavailable('upstream_error', e instanceof Error ? e.message : 'unknown error');
}
