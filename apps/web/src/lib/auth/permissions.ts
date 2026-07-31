import type { Role } from '@atlas/db';

/**
 * Capability-based permissions.
 *
 * Routes and components ask "can this user do X", never "is this user an admin".
 * The difference matters the first time a capability needs to move between roles:
 * with role checks scattered through the codebase, that is a grep-and-pray
 * refactor across dozens of call sites, and the one that gets missed is a
 * privilege bug. Here it is one line in the table below.
 *
 * Roles are additive by convention but the sets are written out in full rather
 * than composed by inheritance — being able to read exactly what a role can do,
 * without resolving a chain, is worth the repetition in a security-relevant file.
 */
export const PERMISSIONS = [
  // Everyone signed in
  'watchlist:read',
  'watchlist:write',
  'portfolio:read',
  'portfolio:write',
  'alert:read',
  'alert:write',
  'notification:read',
  'profile:write',

  // Paid tier
  'alert:unlimited',
  'apikey:manage',
  'export:data',
  'screener:advanced',

  // Operators
  'admin:read',
  'admin:users',
  'admin:flags',
  'admin:keys',
  'admin:queues',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const USER_PERMISSIONS: Permission[] = [
  'watchlist:read',
  'watchlist:write',
  'portfolio:read',
  'portfolio:write',
  'alert:read',
  'alert:write',
  'notification:read',
  'profile:write',
];

const PRO_PERMISSIONS: Permission[] = [
  ...USER_PERMISSIONS,
  'alert:unlimited',
  'apikey:manage',
  'export:data',
  'screener:advanced',
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...PRO_PERMISSIONS,
  'admin:read',
  'admin:users',
  'admin:flags',
  'admin:keys',
  'admin:queues',
  'audit:read',
];

const BY_ROLE: Record<Role, readonly Permission[]> = {
  USER: USER_PERMISSIONS,
  PRO: PRO_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
};

/**
 * Quotas per role. Enforced server-side at the write path — a limit checked only
 * in the UI is not a limit.
 */
export const QUOTAS: Record<Role, { watchlists: number; alerts: number; apiKeys: number }> = {
  USER: { watchlists: 5, alerts: 10, apiKeys: 0 },
  PRO: { watchlists: Number.POSITIVE_INFINITY, alerts: 200, apiKeys: 10 },
  ADMIN: { watchlists: Number.POSITIVE_INFINITY, alerts: Number.POSITIVE_INFINITY, apiKeys: 25 },
};

export function permissionsFor(role: Role): readonly Permission[] {
  return BY_ROLE[role] ?? USER_PERMISSIONS;
}

export function can(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return permissionsFor(role).includes(permission);
}

/** Thrown by the server-side guards. Mapped to 403 by the API error handler. */
export class ForbiddenError extends Error {
  readonly permission: Permission;

  constructor(permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = 'ForbiddenError';
    this.permission = permission;
  }
}
