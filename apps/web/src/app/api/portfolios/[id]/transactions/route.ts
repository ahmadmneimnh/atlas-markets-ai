import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, prisma } from '@atlas/db';

import { requirePermission } from '@/lib/auth';
import { apiError, handleApiError, parseBody, requireDatabase } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  type: z.enum([
    'BUY',
    'SELL',
    'DIVIDEND',
    'DEPOSIT',
    'WITHDRAWAL',
    'FEE',
    'SPLIT',
    'TRANSFER_IN',
    'TRANSFER_OUT',
  ]),
  symbol: z.string().trim().min(1).max(24).toUpperCase().optional(),
  market: z.string().trim().min(1).optional(),
  quantity: z.number().finite().positive().optional(),
  price: z.number().finite().nonnegative().optional(),
  fees: z.number().finite().nonnegative().default(0),
  amount: z.number().finite(),
  executedAt: z.coerce.date(),
  notes: z.string().trim().max(1000).optional(),
});

const NEEDS_ASSET = new Set(['BUY', 'SELL', 'DIVIDEND', 'SPLIT', 'TRANSFER_IN', 'TRANSFER_OUT']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    const user = await requirePermission('portfolio:write');
    const { id } = await params;
    const body = await parseBody(request, createSchema);
    // Destructured up front: TypeScript does not narrow `body.quantity` inside a
    // conditional spread, so the optional Decimal fields need local bindings.
    const { quantity, price, notes } = body;

    const portfolio = await prisma.portfolio.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    // 404 rather than 403: a 403 would confirm the id exists to someone probing.
    if (!portfolio) return apiError(404, 'not_found', 'No such portfolio.');

    if (NEEDS_ASSET.has(body.type) && (!body.symbol || quantity === undefined)) {
      return apiError(
        400,
        'invalid_request',
        `A ${body.type} transaction needs both a symbol and a quantity.`,
      );
    }

    let assetId: string | undefined;
    if (body.symbol) {
      const asset = await prisma.marketAsset.findFirst({
        where: {
          symbol: body.symbol,
          ...(body.market ? { market: body.market as never } : {}),
        },
        select: { id: true },
      });
      if (!asset) {
        return apiError(404, 'unknown_asset', `${body.symbol} is not in the tracked universe.`);
      }
      assetId = asset.id;
    }

    /**
     * The ledger row and its derived lot are written in one transaction.
     *
     * These must not be able to disagree. A ledger entry with no lot understates
     * the position; a lot with no ledger entry cannot be explained. Either both
     * land or neither does.
     */
    const created = await prisma.$transaction(async (tx) => {
      const transaction = await tx.portfolioTransaction.create({
        data: {
          portfolioId: id,
          ...(assetId ? { assetId } : {}),
          type: body.type,
          ...(quantity === undefined ? {} : { quantity: new Prisma.Decimal(quantity) }),
          ...(price === undefined ? {} : { price: new Prisma.Decimal(price) }),
          amount: new Prisma.Decimal(body.amount),
          fees: new Prisma.Decimal(body.fees),
          executedAt: body.executedAt,
          ...(notes === undefined ? {} : { notes }),
        },
      });

      if (body.type === 'BUY' && assetId && quantity !== undefined && price !== undefined) {
        const position = await tx.position.upsert({
          where: { portfolioId_assetId: { portfolioId: id, assetId } },
          create: { portfolioId: id, assetId },
          update: {},
        });

        // A new lot per purchase, never an averaged update. Tax treatment needs
        // per-purchase dates, and averaging at write time destroys them.
        await tx.lot.create({
          data: {
            positionId: position.id,
            quantity: new Prisma.Decimal(quantity),
            pricePaid: new Prisma.Decimal(price),
            fees: new Prisma.Decimal(body.fees),
            purchasedAt: body.executedAt,
          },
        });
      }

      return transaction;
    });

    return NextResponse.json({ transaction: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'POST /api/portfolios/[id]/transactions');
  }
}
