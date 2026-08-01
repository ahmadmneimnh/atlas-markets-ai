import type { Role } from '@atlas/db';

/**
 * Rules that constrain what an administrator may do to an account.
 *
 * Pure functions taking the facts they need, so each rule is testable without a
 * database. The counts are supplied by the caller, which reads them inside the
 * same transaction as the write — checking "are there other admins" outside the
 * transaction races against a second admin being demoted concurrently, and the
 * failure mode of that race is an organisation locked out of its own system.
 */

export interface RoleChangeContext {
  actorId: string;
  targetId: string;
  currentRole: Role;
  nextRole: Role;
  /** Total accounts with ADMIN, including the target. Counted in-transaction. */
  adminCount: number;
}

export type GuardResult = { allowed: true } | { allowed: false; code: string; message: string };

const allow = (): GuardResult => ({ allowed: true });
const deny = (code: string, message: string): GuardResult => ({ allowed: false, code, message });

/**
 * Whether a role change may proceed.
 *
 * The rule that matters is the last one: **the final administrator cannot be
 * demoted.** Without it, one careless click leaves a deployment with no account
 * able to grant the role back, and the only remedy is direct database access —
 * which is precisely the access an admin panel exists to avoid needing.
 *
 * Self-demotion is blocked separately and more strictly than demoting someone
 * else. An admin removing their own access is nearly always a mistake, and the
 * check is cheap; if it is genuinely intended, another admin can do it, which
 * also produces a better audit trail than a self-inflicted change.
 */
export function canChangeRole(context: RoleChangeContext): GuardResult {
  const { actorId, targetId, currentRole, nextRole, adminCount } = context;

  if (currentRole === nextRole) {
    return deny('no_change', `That account already has the ${nextRole} role.`);
  }

  if (actorId === targetId && currentRole === 'ADMIN') {
    return deny(
      'self_demotion',
      'You cannot change your own admin role. Ask another administrator, which also leaves a clearer audit trail.',
    );
  }

  if (currentRole === 'ADMIN' && nextRole !== 'ADMIN' && adminCount <= 1) {
    return deny(
      'last_admin',
      'This is the only administrator account. Promote someone else first — otherwise nobody can grant the role back without direct database access.',
    );
  }

  return allow();
}

export interface BanContext {
  actorId: string;
  targetId: string;
  targetRole: Role;
  alreadyBanned: boolean;
  adminCount: number;
}

/**
 * Whether an account may be suspended.
 *
 * Banning an admin is treated exactly like demoting one, because it has the same
 * effect: the session callback rejects a banned user on their next request, so
 * banning the last administrator locks the deployment out just as thoroughly.
 */
export function canBan(context: BanContext): GuardResult {
  const { actorId, targetId, targetRole, alreadyBanned, adminCount } = context;

  if (alreadyBanned) return deny('already_banned', 'That account is already suspended.');

  if (actorId === targetId) {
    return deny('self_ban', 'You cannot suspend your own account.');
  }

  if (targetRole === 'ADMIN' && adminCount <= 1) {
    return deny(
      'last_admin',
      'That is the only administrator account; suspending it would lock everyone out.',
    );
  }

  return allow();
}

/**
 * Validates a feature flag's percentage rollout.
 *
 * `null` means "no percentage gate" and is distinct from `0`, which means
 * "enabled for nobody". Collapsing them would make a fully-disabled rollout
 * indistinguishable from an ungated one — opposite meanings.
 */
export function validateRollout(value: unknown): GuardResult {
  if (value === null || value === undefined) return allow();
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return deny('invalid_rollout', 'Rollout percentage must be a whole number or null.');
  }
  if (value < 0 || value > 100) {
    return deny('invalid_rollout', 'Rollout percentage must be between 0 and 100.');
  }
  return allow();
}
