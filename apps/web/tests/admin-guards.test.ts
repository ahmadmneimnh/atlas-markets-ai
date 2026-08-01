import { describe, expect, it } from 'vitest';

import { canBan, canChangeRole, validateRollout } from '@/lib/admin/guards';

/**
 * The lockout rules are the ones worth testing hard.
 *
 * Every other admin mistake is recoverable from the admin panel. Removing the
 * last administrator is recoverable only with direct database access — which is
 * exactly the access the panel exists so that nobody needs.
 */

describe('canChangeRole', () => {
  const base = {
    actorId: 'admin-1',
    targetId: 'user-2',
    currentRole: 'USER' as const,
    nextRole: 'PRO' as const,
    adminCount: 2,
  };

  it('allows an ordinary promotion', () => {
    expect(canChangeRole(base).allowed).toBe(true);
  });

  it('refuses to demote the last administrator', () => {
    const result = canChangeRole({
      ...base,
      targetId: 'admin-2',
      currentRole: 'ADMIN',
      nextRole: 'USER',
      adminCount: 1,
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('last_admin');
  });

  it('allows demoting an administrator while others remain', () => {
    const result = canChangeRole({
      ...base,
      targetId: 'admin-2',
      currentRole: 'ADMIN',
      nextRole: 'USER',
      adminCount: 3,
    });

    expect(result.allowed).toBe(true);
  });

  it('blocks self-demotion even when other admins exist', () => {
    const result = canChangeRole({
      ...base,
      targetId: 'admin-1',
      currentRole: 'ADMIN',
      nextRole: 'USER',
      adminCount: 5,
    });

    // Not a lockout risk, but nearly always a mistake — and having another admin
    // do it produces a better audit trail than a self-inflicted change.
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('self_demotion');
  });

  it('rejects a no-op rather than writing a meaningless audit record', () => {
    const result = canChangeRole({ ...base, currentRole: 'PRO', nextRole: 'PRO' });

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('no_change');
  });
});

describe('canBan', () => {
  const base = {
    actorId: 'admin-1',
    targetId: 'user-2',
    targetRole: 'USER' as const,
    alreadyBanned: false,
    adminCount: 2,
  };

  it('allows suspending an ordinary account', () => {
    expect(canBan(base).allowed).toBe(true);
  });

  it('treats banning the last admin as a lockout, same as demoting them', () => {
    const result = canBan({ ...base, targetId: 'admin-2', targetRole: 'ADMIN', adminCount: 1 });

    // A banned user is rejected in the session callback on their next request,
    // so this locks the deployment out exactly as thoroughly as a demotion.
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('last_admin');
  });

  it('blocks self-suspension', () => {
    const result = canBan({ ...base, targetId: 'admin-1' });

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('self_ban');
  });

  it('refuses to re-ban an already suspended account', () => {
    const result = canBan({ ...base, alreadyBanned: true });

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('already_banned');
  });
});

describe('validateRollout', () => {
  it('accepts null as "no percentage gate"', () => {
    expect(validateRollout(null).allowed).toBe(true);
  });

  it('accepts 0 as a distinct, valid value', () => {
    // 0 means "enabled for nobody"; null means "not gated by percentage". They
    // are opposite meanings and both are legitimate.
    expect(validateRollout(0).allowed).toBe(true);
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(validateRollout(101).allowed).toBe(false);
    expect(validateRollout(-1).allowed).toBe(false);
    expect(validateRollout(12.5).allowed).toBe(false);
    expect(validateRollout('50').allowed).toBe(false);
  });
});
