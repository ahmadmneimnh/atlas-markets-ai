import type { AssetKind } from '@/lib/providers/types';

/**
 * Validates the `[kind]/[symbol]` route parameters.
 *
 * The symbol goes straight into a provider URL, so it is whitelisted rather than
 * escaped: anything outside letters, digits, dot and dash is rejected before it can
 * be used to reshape the outbound request.
 */
export function parseAssetParams(
  params: { kind: string; symbol: string },
): { kind: AssetKind; symbol: string } | { error: string } {
  if (params.kind !== 'equity' && params.kind !== 'crypto') {
    return { error: 'kind must be "equity" or "crypto"' };
  }

  const symbol = decodeURIComponent(params.symbol).trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol)) return { error: 'invalid symbol' };

  return { kind: params.kind, symbol };
}
