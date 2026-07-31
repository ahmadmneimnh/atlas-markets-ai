type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

/** Keys whose values must never reach a log sink. */
const REDACT = /^(.*(key|token|secret|password|authorization|cookie).*)$/i;

/** Query parameter names that carry credentials in provider URLs. */
const SECRET_PARAMS = /^(token|apikey|api_key|key|secret|access_token|auth)$/i;

/**
 * Strips credentials out of URL query strings.
 *
 * Redacting by field name alone is not enough: most vendors authenticate by query
 * parameter (`?token=…`, `?apikey=…`), so a perfectly innocent-looking `url` field
 * carries a live secret into the log sink. Provider URLs are logged on every call,
 * which makes this the highest-volume leak path in the system.
 */
export function scrubUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    let touched = false;
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAMS.test(name)) {
        // Bracket-free sentinel: URL.toString() percent-encodes "[]", which turns
        // a scannable log line into "%5Bredacted%5D".
        url.searchParams.set(name, 'REDACTED');
        touched = true;
      }
    }
    return touched ? url.toString() : value;
  } catch {
    // Not a parseable URL — leave it alone rather than dropping the diagnostic.
    return value;
  }
}

function scrub(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (REDACT.test(k)) {
      out[k] = '[redacted]';
    } else if (typeof v === 'string') {
      out[k] = scrubUrl(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emit(level: Level, msg: string, meta: Record<string, unknown> = {}): void {
  if (LEVELS[level] < MIN) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...scrub(meta),
  });
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, meta?: Record<string, unknown>) => emit('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit('error', m, meta),
};
