import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Whether a database is configured at all.
 *
 * Atlas runs without one: browsing and scoring need providers, not Postgres.
 * Callers that need persistence check this and degrade honestly rather than
 * throwing a connection error at a user who never asked for an account.
 */
export const isDatabaseConfigured = Boolean(process.env.DATABASE_URL);

/**
 * Process-wide PrismaClient, constructed on first use.
 *
 * Two problems are solved here, and both are the kind that look like an outage:
 *
 * 1. **Constructing eagerly with no `DATABASE_URL` throws at import time.** Any
 *    module that imports this — directly or three levels down — would then crash
 *    the dev server for someone who just wants to browse crypto scores. The
 *    client is therefore built on first property access, and a missing
 *    connection string produces a sentence explaining what to run instead of a
 *    Prisma stack trace.
 *
 * 2. **Next.js replaces modules on every hot reload.** A fresh client per reload
 *    is a fresh connection pool per reload, and Postgres starts refusing
 *    connections after a few dozen saves. Stashing the instance on `globalThis`
 *    survives module replacement. In production the module graph is stable, so
 *    the global is never used.
 */
const globalForPrisma = globalThis as unknown as { atlasPrisma?: PrismaClient };

function createClient(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set, so the database cannot be reached. Run `npm run infra:up` ' +
        'to start Postgres, copy .env.example to .env, then `npm run db:push`. ' +
        'Features that do not need persistence (market data, scoring) work without it.',
    );
  }

  return new PrismaClient({
    // Query logs are noisy, but they are the only way to catch an N+1 before it
    // reaches a screener page iterating 500 assets.
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  // Module-level cache first, `globalThis` second. Both are needed: the module
  // variable is what keeps production to a single client, and the global is what
  // survives a hot-reload module swap in development. Relying on the global
  // alone would build a fresh client per access in production, which is the
  // connection-pool exhaustion this exists to prevent.
  client ??= globalForPrisma.atlasPrisma ?? createClient();
  if (process.env.NODE_ENV !== 'production') globalForPrisma.atlasPrisma = client;
  return client;
}

/**
 * Proxy rather than the client itself: the real client is only constructed when
 * a property is actually read, which is what makes importing this module safe
 * with no database configured.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getClient(), property, receiver);
  },
  has(_target, property) {
    return Reflect.has(getClient(), property);
  },
});
