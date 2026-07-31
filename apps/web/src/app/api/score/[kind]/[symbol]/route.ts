import { NextResponse } from 'next/server';
import { getScore } from '@/lib/service';
import { findAsset } from '@/lib/universe';
import type { AssetRef } from '@/lib/providers/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string; symbol: string }> },
) {
  const { kind, symbol: raw } = await params;

  if (kind !== 'equity' && kind !== 'crypto') {
    return NextResponse.json({ error: 'kind must be "equity" or "crypto"' }, { status: 400 });
  }

  const symbol = decodeURIComponent(raw).toUpperCase();
  // Reject anything that is not a plausible ticker before spending a provider call.
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return NextResponse.json({ error: 'invalid symbol' }, { status: 400 });
  }

  const known = findAsset(symbol, kind);
  const ref: AssetRef = known ?? { symbol, kind, market: kind === 'crypto' ? 'CRYPTO' : 'NASDAQ' };

  const outcome = await getScore(ref);

  if (!outcome.ok) {
    // 422, not 500: the request was valid, the data was not sufficient.
    return NextResponse.json(
      { error: outcome.message, omitted: outcome.omitted ?? [] },
      { status: 422 },
    );
  }

  return NextResponse.json({
    symbol: outcome.score.ref.symbol,
    market: outcome.score.ref.market,
    kind: outcome.score.ref.kind,
    score: outcome.score.score,
    recommendation: outcome.score.recommendation,
    confidence: outcome.score.confidence,
    reasons: outcome.score.topReasons,
    breakdown: outcome.score.breakdown,
    omitted: outcome.score.omitted,
    sources: outcome.score.sources,
    quote: outcome.quote ?? null,
    computedAt: outcome.score.computedAt.toISOString(),
  });
}
