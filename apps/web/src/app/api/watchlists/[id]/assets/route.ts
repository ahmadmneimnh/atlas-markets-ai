import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@atlas/db';

import { requirePermission } from '@/lib/auth';
import { apiError, handleApiError, parseBody, requireDatabase } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

const addSchema = z.object({
  symbol: z.string().trim().min(1).max(24).toUpperCase(),
  market: z.string().trim().min(1),
  note: z.string().trim().max(500).optional(),
});

/** Confirms the watchlist exists AND belongs to the caller, in one query. */
async function ownedWatchlist(id: string, userId: string) {
  return prisma.watchlist.findFirst({ where: { id, userId }, select: { id: true } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    const user = await requirePermission('watchlist:write');
    const { id } = await params;
    const body = await parseBody(request, addSchema);

    // 404 rather than 403 for someone else's watchlist: a 403 confirms the id
    // exists, which turns this endpoint into an enumeration oracle.
    if (!(await ownedWatchlist(id, user.id))) {
      return apiError(404, 'not_found', 'No such watchlist.');
    }

    const asset = await prisma.marketAsset.findFirst({
      where: { symbol: body.symbol, market: body.market as never },
      select: { id: true },
    });
    if (!asset) {
      return apiError(404, 'unknown_asset', `${body.symbol} is not in the tracked universe.`);
    }

    const item = await prisma.watchlistAsset.create({
      data: {
        watchlistId: id,
        assetId: asset.id,
        ...(body.note === undefined ? {} : { note: body.note }),
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return apiError(409, 'already_present', 'That asset is already on this watchlist.');
    }
    return handleApiError(error, 'POST /api/watchlists/[id]/assets');
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    const user = await requirePermission('watchlist:write');
    const { id } = await params;
    const assetId = new URL(request.url).searchParams.get('assetId');
    if (!assetId) return apiError(400, 'invalid_request', 'assetId is required.');

    if (!(await ownedWatchlist(id, user.id))) {
      return apiError(404, 'not_found', 'No such watchlist.');
    }

    await prisma.watchlistAsset.deleteMany({ where: { watchlistId: id, assetId } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'DELETE /api/watchlists/[id]/assets');
  }
}
