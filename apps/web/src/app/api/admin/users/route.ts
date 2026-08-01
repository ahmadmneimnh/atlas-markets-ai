import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@atlas/db';

import { requirePermission } from '@/lib/auth';
import { recordAudit } from '@/lib/admin/audit';
import { canBan, canChangeRole } from '@/lib/admin/guards';
import { apiError, handleApiError, parseBody, requireDatabase } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['USER', 'PRO', 'ADMIN']).optional(),
  banned: z.boolean().optional(),
  banReason: z.string().trim().max(500).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    await requirePermission('admin:users');
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim();
    const take = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

    const users = await prisma.user.findMany({
      where: query
        ? {
            OR: [
              { email: { contains: query, mode: 'insensitive' } },
              { name: { contains: query, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      // Explicit select, never the whole row. `select` here is the difference
      // between an admin list and a data export: sessions, OAuth tokens and API
      // key hashes all hang off this model and none of them belong in a response.
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        bannedAt: true,
        bannedReason: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { watchlists: true, portfolios: true, alerts: true } },
      },
    });

    return NextResponse.json({ users });
  } catch (error) {
    return handleApiError(error, 'GET /api/admin/users');
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    const actor = await requirePermission('admin:users');
    const body = await parseBody(request, patchSchema);

    if (body.role === undefined && body.banned === undefined) {
      return apiError(400, 'invalid_request', 'Specify a role change or a ban state.');
    }

    /**
     * The guard check, the write and the audit record share one transaction.
     *
     * Counting administrators outside it races against another admin being
     * demoted concurrently — two requests each see two admins, each demotes one,
     * and the deployment is left with none. That failure is unrecoverable from
     * this panel, which is the whole reason the count is read in here.
     */
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: body.userId },
        select: { id: true, email: true, role: true, bannedAt: true },
      });
      if (!target) return { error: apiError(404, 'not_found', 'No such user.') };

      const adminCount = await tx.user.count({ where: { role: 'ADMIN', bannedAt: null } });

      if (body.role !== undefined) {
        const verdict = canChangeRole({
          actorId: actor.id,
          targetId: target.id,
          currentRole: target.role,
          nextRole: body.role,
          adminCount,
        });
        if (!verdict.allowed) {
          return { error: apiError(409, verdict.code, verdict.message) };
        }

        await tx.user.update({ where: { id: target.id }, data: { role: body.role } });
        await recordAudit(
          {
            actorId: actor.id,
            action: 'user.role_changed',
            target: target.id,
            before: { role: target.role },
            after: { role: body.role },
            request,
          },
          tx,
        );
      }

      if (body.banned !== undefined) {
        if (body.banned) {
          const verdict = canBan({
            actorId: actor.id,
            targetId: target.id,
            targetRole: target.role,
            alreadyBanned: target.bannedAt !== null,
            adminCount,
          });
          if (!verdict.allowed) {
            return { error: apiError(409, verdict.code, verdict.message) };
          }

          await tx.user.update({
            where: { id: target.id },
            data: { bannedAt: new Date(), bannedReason: body.banReason ?? null },
          });
          // Sessions are deleted, not left to expire. The session callback
          // rejects a banned user on their next request, but an active session
          // row is a loose end and deleting it makes the ban immediate and
          // total rather than merely effective.
          await tx.session.deleteMany({ where: { userId: target.id } });

          await recordAudit(
            {
              actorId: actor.id,
              action: 'user.banned',
              target: target.id,
              before: { bannedAt: null },
              after: { bannedAt: new Date().toISOString(), reason: body.banReason ?? null },
              request,
            },
            tx,
          );
        } else {
          await tx.user.update({
            where: { id: target.id },
            data: { bannedAt: null, bannedReason: null },
          });
          await recordAudit(
            {
              actorId: actor.id,
              action: 'user.unbanned',
              target: target.id,
              before: { bannedAt: target.bannedAt?.toISOString() ?? null },
              after: { bannedAt: null },
              request,
            },
            tx,
          );
        }
      }

      const updated = await tx.user.findUnique({
        where: { id: target.id },
        select: { id: true, email: true, role: true, bannedAt: true, bannedReason: true },
      });
      return { user: updated };
    });

    if ('error' in result && result.error) return result.error;
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'PATCH /api/admin/users');
  }
}
