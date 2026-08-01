import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@atlas/db';

import { QUOTAS, requirePermission } from '@/lib/auth';
import { apiError, handleApiError, parseBody, requireDatabase } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  isDefault: z.boolean().optional(),
});

export async function GET(): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    const user = await requirePermission('watchlist:read');
    const watchlists = await prisma.watchlist.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        assets: {
          include: { asset: { select: { symbol: true, kind: true, name: true, market: true } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    return NextResponse.json({ watchlists });
  } catch (error) {
    return handleApiError(error, 'GET /api/watchlists');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    const user = await requirePermission('watchlist:write');
    const body = await parseBody(request, createSchema);

    // Quota is enforced here, server-side. A limit checked only in the UI is not
    // a limit — the API is the boundary that actually holds.
    const existing = await prisma.watchlist.count({ where: { userId: user.id } });
    const limit = QUOTAS[user.role ?? 'USER'].watchlists;
    if (existing >= limit) {
      return apiError(
        403,
        'quota_exceeded',
        `Your plan allows ${limit} watchlists. Delete one or upgrade to add another.`,
        { limit, current: existing },
      );
    }

    const watchlist = await prisma.watchlist.create({
      data: { userId: user.id, name: body.name, isDefault: body.isDefault ?? existing === 0 },
    });
    return NextResponse.json({ watchlist }, { status: 201 });
  } catch (error) {
    // The unique constraint on (userId, name) is the arbiter, not a prior read:
    // a check-then-insert races against the user's own second tab.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return apiError(409, 'duplicate_name', 'You already have a watchlist with that name.');
    }
    return handleApiError(error, 'POST /api/watchlists');
  }
}
