import { env } from './env';

/**
 * Structured JSON logging with credential redaction.
 *
 * One line per event, machine-parseable, and every value passing through
 * `redact` before it is serialised. Provider errors routinely echo the request
 * URL back in the message, and those URLs carry API keys as query parameters —
 * logging an error object verbatim is how a key ends up in a log aggregator that
 * a dozen people can read.
 *
 * This mirrors `apps/web/src/lib/logger.ts` rather than importing it: pulling a
 * logger out into a shared package couples the deploy cadence of every service
 * to it, and the implementation is thirty lines.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[env.LOG_LEVEL];

/** Anything whose key looks credential-bearing, plus key-shaped query params. */
const SECRET_KEY = /(api[_-]?key|token|secret|password|authorization|apikey)/i;
const SECRET_QUERY = /([?&](?:apikey|api_key|token|key|access_key)=)[^&\s]+/gi;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (typeof value === 'string') return value.replace(SECRET_QUERY, '$1[redacted]');
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message, depth + 1), stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        SECRET_KEY.test(k) ? [k, '[redacted]'] : [k, redact(v, depth + 1)],
      ),
    );
  }
  return value;
}

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    service: 'worker',
    message,
    ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
  };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
}

export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => emit('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => emit('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => emit('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => emit('error', m, c),
};
