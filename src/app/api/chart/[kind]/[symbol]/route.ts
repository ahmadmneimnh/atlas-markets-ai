import { NextResponse } from 'next/server';
import { market } from '@/lib/providers/registry';
import { isChartRange, RANGE_DAYS, toChartDTO, toUnavailableDTO, type ChartRange } from '@/lib/dto';
import { parseAssetParams } from '@/app/api/_params';

export const dynamic = 'force-dynamic';

/** Daily closing prices for the interactive chart. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ kind: string; symbol: string }> },
) {
  const parsed = parseAssetParams(await params);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const rangeParam = new URL(req.url).searchParams.get('range') ?? '3M';
  const range: ChartRange = isChartRange(rangeParam) ? rangeParam : '3M';

  // One request covers every range: the provider call is cached for six hours and
  // sliced per range, so switching between 1W and 1Y costs no extra quota.
  const result = await market.ohlcv(parsed.symbol, parsed.kind, '1d', RANGE_DAYS['1Y']);

  return NextResponse.json({
    chart: result.ok ? toChartDTO(result.data, parsed.kind, range) : null,
    unavailable: toUnavailableDTO(result),
  });
}
