import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@atlas/db';

import { requirePermission } from '@/lib/auth';
import { apiError, handleApiError, parseBody, requireDatabase } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  baseCurrency: z.string().trim().length(3).toUpperCase().default('USD'),
});

export async function GET(): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    const user = await requirePermission('portfolio:read');
    const portfolios = await prisma.portfolio.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      include: {
        positions: {
          include: {
            asset: { select: { symbol: true, kind: true, name: true, market: true } },
            lots: { where: { soldAt: null }, orderBy: { purchasedAt: 'asc' } },
          },
        },
      },
    });
    return NextResponse.json({ portfolios });
  } catch (error) {
    return handleApiError(error, 'GET /api/portfolios');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    const user = await requirePermission('portfolio:write');
    const body = await parseBody(request, createSchema);

    const portfolio = await prisma.portfolio.create({
      data: { userId: user.id, name: body.name, baseCurrency: body.baseCurrency },
    });
    return NextResponse.json({ portfolio }, { status: 201 });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return apiError(409, 'duplicate_name', 'You already have a portfolio with that name.');
    }
    return handleApiError(error, 'POST /api/portfolios');
  }
}
