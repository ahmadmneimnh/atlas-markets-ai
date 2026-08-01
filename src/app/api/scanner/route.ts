import { NextResponse } from 'next/server';
import { scanMarket } from '@/lib/analysis/scanner';

export const dynamic = 'force-dynamic';

/**
 * The full scan. Cached for five minutes underneath, so hitting this repeatedly does
 * not re-run the engine or spend provider quota.
 */
export async function GET() {
  const scan = await scanMarket();
  return NextResponse.json(scan, { headers: { 'cache-control': 'no-store' } });
}
