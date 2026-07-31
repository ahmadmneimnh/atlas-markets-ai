import { NextResponse } from 'next/server';
import { market } from '@/lib/providers/registry';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 1) return NextResponse.json({ results: [] });
  if (q.length > 50) return NextResponse.json({ error: 'query too long' }, { status: 400 });

  const result = await market.search(q);
  if (!result.ok) {
    return NextResponse.json({ results: [], unavailable: result.reason }, { status: 200 });
  }
  return NextResponse.json({ results: result.data });
}
