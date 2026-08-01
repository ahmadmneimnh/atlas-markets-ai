import { NextResponse } from 'next/server';

import { runDailyScan, runScanner } from '@/lib/service';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scanner
 *
 * Ranked buy / hold / sell lists over the tracked universe, from live provider
 * data. Rate-limited at the scoring tier because that is what it costs: a scan
 * fans out across every asset and every configured provider.
 *
 * Citations travel with every entry. A ranked list without the signals behind it
 * is a tip sheet, and the response shape makes it impossible to serve one — the
 * scanner cannot emit an opportunity that carries no evidence.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const limited = enforceRateLimit(request, RATE_LIMITS.score);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const kindParam = params.get('kind');
  const kind = kindParam === 'equity' || kindParam === 'crypto' ? kindParam : 'all';
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 5), 1), 25);

  // ?mode=daily returns the complete ranking, stable for the UTC day. The
  // default stays the live top-N so an existing caller sees no change.
  if (params.get('mode') === 'daily') {
    const { result, scanDate } = await runDailyScan(kind);
    return NextResponse.json({
      mode: 'daily',
      scanDate,
      scannedAt: result.scannedAt.toISOString(),
      coverage: result.coverage,
      confidenceFloor: 45,
      // Strongest buy first, strongest sell last, nothing filtered out.
      ranked: result.ranked,
    });
  }

  const result = await runScanner(kind, limit);

  return NextResponse.json({
    mode: 'live',
    scannedAt: result.scannedAt.toISOString(),
    // Stated up front so a caller can judge the lists: 3 of 30 scored is a very
    // different answer from 30 of 30, and both are legitimate.
    coverage: result.coverage,
    confidenceFloor: 45,
    buy: result.buy,
    hold: result.hold,
    sell: result.sell,
    lowConfidence: result.lowConfidence,
  });
}
