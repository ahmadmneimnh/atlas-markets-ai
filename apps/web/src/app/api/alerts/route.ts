import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, prisma } from '@atlas/db';

import { QUOTAS, requirePermission } from '@/lib/auth';
import { apiError, handleApiError, parseBody, requireDatabase } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Alert rules.
 *
 * `params` is validated per alert type rather than accepted as free-form JSON.
 * An alert whose threshold is missing does not fire, does not error, and gives no
 * indication of either — it simply never triggers, and the user discovers that
 * when they miss the move they set it for.
 */
const paramsByType = {
  PRICE_ABOVE: z.object({ threshold: z.number().finite() }),
  PRICE_BELOW: z.object({ threshold: z.number().finite() }),
  PERCENT_MOVE: z.object({
    percent: z.number().finite().positive(),
    window: z.enum(['1h', '24h', '7d']),
  }),
  VOLUME_SPIKE: z.object({ multiple: z.number().finite().min(1.1) }),
  RSI_ABOVE: z.object({
    threshold: z.number().min(0).max(100),
    period: z.number().int().min(2).max(200).default(14),
  }),
  RSI_BELOW: z.object({
    threshold: z.number().min(0).max(100),
    period: z.number().int().min(2).max(200).default(14),
  }),
  MACD_CROSSOVER: z.object({ direction: z.enum(['bullish', 'bearish', 'any']).default('any') }),
  GOLDEN_CROSS: z.object({
    fast: z.number().int().default(50),
    slow: z.number().int().default(200),
  }),
  DEATH_CROSS: z.object({
    fast: z.number().int().default(50),
    slow: z.number().int().default(200),
  }),
  RECOMMENDATION_CHANGE: z.object({
    direction: z.enum(['upgrade', 'downgrade', 'any']).default('any'),
  }),
  BREAKING_NEWS: z.object({ minRelevance: z.number().min(0).max(1).default(0.5) }),
  SENTIMENT_SHIFT: z.object({ delta: z.number().min(0).max(2).default(0.4) }),
} as const;

const createSchema = z
  .object({
    symbol: z.string().trim().min(1).max(24).toUpperCase(),
    market: z.string().trim().min(1),
    type: z.enum(Object.keys(paramsByType) as [keyof typeof paramsByType]),
    params: z.unknown(),
    channels: z
      .array(z.enum(['IN_APP', 'EMAIL', 'PUSH', 'SMS', 'TELEGRAM', 'DISCORD', 'WEBHOOK']))
      .min(1),
    cooldownMinutes: z.number().int().min(1).max(10_080).default(60),
  })
  .transform((value, ctx) => {
    const schema = paramsByType[value.type];
    const parsed = schema.safeParse(value.params);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ['params', ...issue.path] });
      }
      return z.NEVER;
    }
    return { ...value, params: parsed.data as Record<string, unknown> };
  });

export async function GET(): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    const user = await requirePermission('alert:read');
    const alerts = await prisma.alert.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { asset: { select: { symbol: true, kind: true, name: true } } },
    });
    return NextResponse.json({ alerts });
  } catch (error) {
    return handleApiError(error, 'GET /api/alerts');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    const user = await requirePermission('alert:write');
    const body = await parseBody(request, createSchema);

    // Alert quota is real, not arbitrary: every enabled alert costs provider
    // calls on each evaluation sweep, so an unbounded count is a way for one
    // account to exhaust the shared quota for everybody.
    const existing = await prisma.alert.count({ where: { userId: user.id, enabled: true } });
    const limit = QUOTAS[user.role ?? 'USER'].alerts;
    if (existing >= limit) {
      return apiError(403, 'quota_exceeded', `Your plan allows ${limit} active alerts.`, {
        limit,
        current: existing,
      });
    }

    const asset = await prisma.marketAsset.findFirst({
      where: { symbol: body.symbol, market: body.market as never },
      select: { id: true },
    });
    if (!asset) {
      return apiError(404, 'unknown_asset', `${body.symbol} is not in the tracked universe.`);
    }

    const alert = await prisma.alert.create({
      data: {
        userId: user.id,
        assetId: asset.id,
        type: body.type,
        // Cast at the Prisma boundary only: the value has already been validated
        // against this alert type's schema above, so the shape is known even
        // though Prisma's InputJsonValue cannot express it.
        params: body.params as Prisma.InputJsonValue,
        channels: body.channels,
        cooldownMinutes: body.cooldownMinutes,
      },
    });
    return NextResponse.json({ alert }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'POST /api/alerts');
  }
}
