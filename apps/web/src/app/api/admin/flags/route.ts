import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@atlas/db';

import { requirePermission } from '@/lib/auth';
import { recordAudit } from '@/lib/admin/audit';
import { validateRollout } from '@/lib/admin/guards';
import { apiError, handleApiError, parseBody, requireDatabase } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  key: z.string().trim().min(1).max(80),
  enabled: z.boolean().optional(),
  // `null` is meaningful and distinct from omitting the field: null clears the
  // percentage gate, omitting it leaves whatever is there.
  rolloutPct: z.number().int().nullable().optional(),
});

export async function GET(): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    await requirePermission('admin:flags');
    const flags = await prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
    return NextResponse.json({ flags });
  } catch (error) {
    return handleApiError(error, 'GET /api/admin/flags');
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const blocked = requireDatabase();
  if (blocked) return blocked;

  try {
    const actor = await requirePermission('admin:flags');
    const body = await parseBody(request, patchSchema);

    if (body.rolloutPct !== undefined) {
      const verdict = validateRollout(body.rolloutPct);
      if (!verdict.allowed) return apiError(400, verdict.code, verdict.message);
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.featureFlag.findUnique({ where: { key: body.key } });
      if (!existing) return { error: apiError(404, 'not_found', 'No such feature flag.') };

      const flag = await tx.featureFlag.update({
        where: { key: body.key },
        data: {
          ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
          ...(body.rolloutPct === undefined ? {} : { rolloutPct: body.rolloutPct }),
        },
      });

      await recordAudit(
        {
          actorId: actor.id,
          action: body.enabled !== undefined ? 'flag.toggled' : 'flag.rollout_changed',
          target: body.key,
          before: { enabled: existing.enabled, rolloutPct: existing.rolloutPct },
          after: { enabled: flag.enabled, rolloutPct: flag.rolloutPct },
          request,
        },
        tx,
      );

      return { flag };
    });

    if ('error' in result && result.error) return result.error;
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'PATCH /api/admin/flags');
  }
}
