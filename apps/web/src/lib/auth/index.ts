import 'server-only';

import NextAuth from 'next-auth';
import type { Session } from 'next-auth';

import { authConfig, isAuthConfigured } from './config';
import { ForbiddenError, QUOTAS, can, type Permission } from './permissions';

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export { isAuthConfigured };
export * from './permissions';
export { providerStatuses } from './providers';

/**
 * The current session, or null.
 *
 * Returns null rather than throwing when auth is not configured, so every caller
 * has one "signed out" branch instead of two.
 */
export async function currentUser(): Promise<Session['user'] | null> {
  if (!isAuthConfigured) return null;
  const session = await auth();
  return session?.user ?? null;
}

/** Thrown by `requireUser`. Mapped to 401 by the API error handler. */
export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Guard for anything user-owned. Throws rather than returning null so a caller
 * cannot forget to check — an ignored return value is a data leak, an ignored
 * throw is impossible.
 */
export async function requireUser(): Promise<NonNullable<Session['user']>> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Guard for a specific capability. */
export async function requirePermission(
  permission: Permission,
): Promise<NonNullable<Session['user']>> {
  const user = await requireUser();
  if (!can(user.role, permission)) throw new ForbiddenError(permission);
  return user;
}

/**
 * Quota check for the write paths.
 *
 * `current` is passed in rather than counted here: the caller already holds the
 * row it is about to extend, and a second COUNT would be both wasteful and
 * racy against its own transaction.
 */
export function withinQuota(
  role: NonNullable<Session['user']>['role'],
  resource: keyof typeof QUOTAS.USER,
  current: number,
): boolean {
  return current < QUOTAS[role ?? 'USER'][resource];
}
