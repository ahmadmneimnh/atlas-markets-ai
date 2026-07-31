/**
 * `@atlas/core` — the contracts every Atlas service agrees on.
 *
 * Rule for what belongs here: a type earns a place in this package only if more
 * than one process needs it. Domain logic does not live here — the scoring
 * engine, the provider adapters and the Prisma models each have an owner. A
 * shared package that accumulates implementation becomes the thing every service
 * must redeploy together, which is the opposite of why it exists.
 */
export * from './contracts/scoring';
export * from './contracts/queues';
