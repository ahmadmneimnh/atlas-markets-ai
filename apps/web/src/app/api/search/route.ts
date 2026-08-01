import { NextResponse } from 'next/server';
import { market } from '@/lib/providers/registry';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, RATE_LIMITS.search);
  if (limited) return limited;

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 1) return NextResponse.json({ results: [] });
  if (q.length > 50) return NextResponse.json({ error: 'query too long' }, { status: 400 });

  const result = await market.search(q);
  if (!result.ok) {
    return NextResponse.json({ results: [], unavailable: result.reason }, { status: 200 });
  }
  return NextResponse.json({ results: result.data });
}
