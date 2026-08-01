import { NextResponse } from 'next/server';

import { market } from '@/lib/providers/registry';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { searchUniverse } from '@/lib/search/local';
import type { AssetKind, Market } from '@/lib/providers/types';

export const dynamic = 'force-dynamic';

/**
 * Autocomplete for the global search bar.
 *
 * Two tiers, and the split is the whole design:
 *
 * 1. **Local** — the tracked universe, matched in-process. No network, no
 *    provider quota, returns in well under a millisecond. This is what makes
 *    typing feel instant, and it is why autocomplete does not exhaust a free
 *    tier on the third keystroke.
 *
 * 2. **Provider** — anything outside the tracked list. Only consulted for
 *    queries of two characters or more, and its results are appended below the
 *    local ones rather than merged by score: a vendor's relevance ranking is not
 *    comparable to ours, and interleaving them would shuffle the local hits a
 *    user is already reaching for.
 *
 * The response always says which tier each hit came from, so the UI can label
 * "tracked" results and the caller can tell an empty provider tier (no key) from
 * an empty result set (no such asset).
 */
export interface Suggestion {
  symbol: string;
  name: string;
  kind: AssetKind;
  market: Market;
  source: 'universe' | string;
  /** True when the asset is in the tracked universe and therefore scoreable now. */
  tracked: boolean;
}

const PROVIDER_MIN_QUERY = 2;

export async function GET(request: Request): Promise<NextResponse> {
  const limited = enforceRateLimit(request, RATE_LIMITS.search);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const query = params.get('q')?.trim() ?? '';
  const kindParam = params.get('kind');
  const kind = kindParam === 'equity' || kindParam === 'crypto' ? kindParam : undefined;

  if (query.length === 0) return NextResponse.json({ suggestions: [] });
  if (query.length > 50) {
    return NextResponse.json({ error: 'query too long' }, { status: 400 });
  }

  const local = searchUniverse(query, { limit: 6, ...(kind ? { kind } : {}) });

  const suggestions: Suggestion[] = local.map((hit) => ({
    symbol: hit.symbol,
    name: hit.name,
    kind: hit.kind,
    market: hit.market,
    source: 'universe',
    tracked: true,
  }));

  // A single character matches too much to be worth a network round trip, and
  // the local tier already answers it well.
  let providerUnavailable: string | undefined;
  if (query.length >= PROVIDER_MIN_QUERY) {
    const remote = await market.search(query);

    if (remote.ok) {
      const seen = new Set(suggestions.map((s) => `${s.kind}:${s.symbol}`));
      for (const hit of remote.data) {
        const key = `${hit.kind}:${hit.symbol}`;
        // Deduplicated against the local tier: a tracked asset returned by a
        // provider too would otherwise appear twice, once labelled tracked and
        // once not, which reads as two different instruments.
        if (seen.has(key)) continue;
        if (kind && hit.kind !== kind) continue;
        seen.add(key);
        suggestions.push({
          symbol: hit.symbol,
          name: hit.name,
          kind: hit.kind,
          market: hit.market,
          source: hit.source,
          tracked: false,
        });
      }
    } else {
      // Reported, not swallowed. The UI stays useful on local hits alone, and an
      // operator can tell "no provider configured" apart from "no such asset".
      providerUnavailable = remote.reason;
    }
  }

  return NextResponse.json({
    suggestions: suggestions.slice(0, 10),
    ...(providerUnavailable ? { providerUnavailable } : {}),
  });
}
