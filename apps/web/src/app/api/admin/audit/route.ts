import { NextResponse } from 'next/server';
import { prisma } from '@atlas/db';

import { requirePermission } from '@/lib/auth';
import { handleApiError, requireDatabase } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * The audit log is read-only over HTTP.
 *
 * There is deliberately no DELETE and no PATCH. An audit log an administrator
 * can edit is not an audit log — retention is a database-level policy, applied
 * by a scheduled job, not something reachable from the panel it records.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    await requirePermission('audit:read');

    const url = new URL(request.url);
    const action = url.searchParams.get('action')?.trim();
    const actorId = url.searchParams.get('actorId')?.trim();
    const take = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);

    const entries = await prisma.auditLog.findMany({
      where: {
        ...(action ? { action } : {}),
        ...(actorId ? { actorId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: { actor: { select: { id: true, email: true, name: true } } },
    });

    return NextResponse.json({ entries });
  } catch (error) {
    return handleApiError(error, 'GET /api/admin/audit');
  }
}
