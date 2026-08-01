import { NextResponse } from 'next/server';
import { providerStatus } from '@/lib/providers/registry';
import { coverage } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Liveness and configuration report. Says which keys are present, never their
 * values — useful for checking a setup without printing secrets to a terminal.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    coverage: coverage(),
    providers: providerStatus().map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.configured,
      capabilities: p.capabilities,
    })),
    timestamp: new Date().toISOString(),
  });
}
