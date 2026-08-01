import { NextResponse } from 'next/server';
import { market } from '@/lib/providers/registry';
import { toQuoteDTO, toUnavailableDTO } from '@/lib/dto';
import { parseAssetParams } from '@/app/api/_params';

export const dynamic = 'force-dynamic';

/** A single live quote — the polling endpoint behind an asset page's header. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string; symbol: string }> },
) {
  const parsed = parseAssetParams(await params);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await market.quote(parsed.symbol, parsed.kind);

  return NextResponse.json(
    {
      quote: result.ok ? toQuoteDTO(result.data) : null,
      unavailable: toUnavailableDTO(result),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
