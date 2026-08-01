import { NextResponse } from 'next/server';
import { analyseAsset } from '@/lib/analysis/engine';
import { parseAssetParams } from '@/app/api/_params';

export const dynamic = 'force-dynamic';

/** The full recommendation for one asset, exactly as the asset page renders it. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string; symbol: string }> },
) {
  const parsed = parseAssetParams(await params);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const analysis = await analyseAsset({ symbol: parsed.symbol, kind: parsed.kind });
  return NextResponse.json(analysis, { headers: { 'cache-control': 'no-store' } });
}
