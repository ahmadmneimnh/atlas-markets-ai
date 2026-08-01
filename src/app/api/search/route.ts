import { NextResponse } from 'next/server';
import { market } from '@/lib/providers/registry';
import { toUnavailableDTO } from '@/lib/dto';

export const dynamic = 'force-dynamic';

/** Symbol search across both asset classes. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 1) return NextResponse.json({ results: [] });
  if (q.length > 50) return NextResponse.json({ error: 'query too long' }, { status: 400 });

  const result = await market.search(q);

  // An empty result set is a normal answer, not a server fault — a 200 with an
  // explanation lets the UI say why rather than showing a generic failure.
  return NextResponse.json({
    results: result.ok ? result.data : [],
    unavailable: toUnavailableDTO(result),
  });
}
