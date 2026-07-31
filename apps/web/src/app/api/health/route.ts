import { NextResponse } from 'next/server';
import { providerStatus } from '@/lib/providers/registry';
import { SCORERS } from '@/lib/analysis/engine';

export const dynamic = 'force-dynamic';

/** Liveness + configuration report. Never returns credential values. */
export async function GET() {
  const providers = providerStatus();
  return NextResponse.json({
    status: 'ok',
    providers: providers.map((p) => ({
      id: p.id,
      configured: p.configured,
      capabilities: p.capabilities,
    })),
    factors: SCORERS.map((s) => ({ factor: s.factor, nominalWeight: s.weight })),
    timestamp: new Date().toISOString(),
  });
}
