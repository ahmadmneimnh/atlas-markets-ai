import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Process-wide PrismaClient.
 *
 * Next.js hot-reloads modules on every edit in development. A fresh
 * `new PrismaClient()` per reload opens a fresh connection pool per reload, and
 * Postgres starts refusing connections after a few dozen saves — the failure
 * looks like a database outage and is entirely self-inflicted. Stashing the
 * instance on `globalThis` survives module replacement, which is why this
 * pattern exists rather than a plain module-level constant.
 *
 * In production the module graph is stable, so the global is not used.
 */
const globalForPrisma = globalThis as unknown as { atlasPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.atlasPrisma ??
  new PrismaClient({
    // Query logs are noisy but they are the only way to catch an N+1 before it
    // reaches a screener page iterating 500 assets.
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.atlasPrisma = prisma;
}
