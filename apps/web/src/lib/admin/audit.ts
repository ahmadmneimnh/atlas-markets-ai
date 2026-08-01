import 'server-only';

import { Prisma, prisma } from '@atlas/db';

import { log } from '@/lib/logger';

/**
 * Audit logging for every administrative mutation.
 *
 * The point of an audit log is answering "who changed this, when, and from
 * what" months later, when the person who did it has forgotten. Three
 * consequences shape this module:
 *
 * 1. **Before and after are both recorded.** "Role changed to ADMIN" is far less
 *    useful than "USER → ADMIN", because only the second tells you whether the
 *    change was a promotion or a no-op, and what to restore.
 *
 * 2. **A failed audit write fails the request.** The tempting alternative is to
 *    log the error and let the mutation stand — which produces exactly the
 *    situation an audit log exists to prevent: a change nobody can attribute.
 *    Callers therefore run `recordAudit` inside the same transaction as the
 *    change itself.
 *
 * 3. **`actorId` is `SetNull` on delete, not `Cascade`.** Deleting an admin must
 *    not erase the record of what they did.
 */

/**
 * Action names are a closed set, not free-form strings.
 *
 * A free-form action field drifts — `user.ban`, `ban_user`, `banUser` all appear
 * within a year and no query finds all three.
 */
export const AUDIT_ACTIONS = [
  'user.role_changed',
  'user.banned',
  'user.unbanned',
  'flag.toggled',
  'flag.rollout_changed',
  'apikey.revoked',
  'queue.job_retried',
  'queue.drained',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  /** What was acted on: a user id, a flag key, a queue name. */
  target: string;
  before?: unknown;
  after?: unknown;
  request?: Request;
}

/**
 * Extracts client metadata worth keeping.
 *
 * The IP is only meaningful behind a proxy that sets `x-forwarded-for`; it is
 * recorded as-supplied rather than validated, because a wrong-looking IP in an
 * audit record is itself a signal, whereas a silently dropped one is nothing.
 */
function requestMetadata(request?: Request): { ipAddress?: string; userAgent?: string } {
  if (!request) return {};
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? undefined;
  const userAgent = request.headers.get('user-agent') ?? undefined;
  return {
    ...(ip ? { ipAddress: ip } : {}),
    ...(userAgent ? { userAgent: userAgent.slice(0, 500) } : {}),
  };
}

/**
 * Writes an audit record.
 *
 * `client` accepts a transaction handle so the record and the change it
 * describes commit together. Passing the bare `prisma` client is valid for
 * read-only or already-committed events, but a mutation should not.
 */
export async function recordAudit(
  entry: AuditEntry,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const { before, after, request, ...rest } = entry;

  await client.auditLog.create({
    data: {
      ...rest,
      ...requestMetadata(request),
      metadata: {
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
      } as Prisma.InputJsonValue,
    },
  });

  // Also emitted to the structured log so an operator watching a live tail sees
  // administrative activity without querying the database.
  log.info('admin_action', { action: entry.action, target: entry.target, actor: entry.actorId });
}
