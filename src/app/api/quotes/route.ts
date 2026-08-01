import { NextResponse } from 'next/server';
import { market } from '@/lib/providers/registry';
import { toRowDTO, type AssetRowDTO } from '@/lib/dto';
import { trackedUniverse } from '@/lib/universe';

export const dynamic = 'force-dynamic';

/**
 * Quotes for every tracked asset — the dashboard's polling endpoint.
 *
 * Assets whose provider failed are returned with `quote: null` and a reason rather
 * than dropped, so the table can say "Insufficient Data" on that row instead of
 * quietly shrinking.
 */
export async function GET() {
  const refs = trackedUniverse();
  const results = await market.quotes(refs);

  const rows: AssetRowDTO[] = results.map((r, i) => {
    const ref = refs[i]!;
    return toRowDTO({ symbol: ref.symbol, name: ref.name, kind: ref.kind }, r.result);
  });

  return NextResponse.json(
    { rows },
    { headers: { 'cache-control': 'no-store' } },
  );
}
