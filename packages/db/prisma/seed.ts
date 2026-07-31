import { prisma } from '../src/index';

/**
 * Idempotent bootstrap seed.
 *
 * What is deliberately *not* here: the tracked asset universe. That list already
 * exists at `apps/web/src/lib/universe.ts`, and copying it into the seed would
 * create a second source of truth that silently drifts. It moves into
 * `@atlas/core` in Phase 2 and is seeded from there — one copy, two consumers.
 *
 * What will never be here: prices, scores, or any other market datum. A seeded
 * price is indistinguishable from a real one once it is in the table.
 */
const FEATURE_FLAGS = [
  { key: 'alerts.email', description: 'Deliver triggered alerts over email' },
  { key: 'alerts.push', description: 'Deliver triggered alerts as web push' },
  { key: 'portfolio.lots', description: 'Lot-level cost basis in the portfolio view' },
  {
    key: 'engine.background',
    description: 'Score the universe on a schedule rather than on request',
  },
  { key: 'admin.keyRotation', description: 'Provider key rotation from the admin panel' },
] as const;

async function main(): Promise<void> {
  for (const flag of FEATURE_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      // Only the description is refreshed: re-running the seed must never flip a
      // flag an operator turned on in production.
      update: { description: flag.description },
      create: { key: flag.key, description: flag.description, enabled: false },
    });
  }

  console.log(`seeded ${FEATURE_FLAGS.length} feature flags`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
