import Link from 'next/link';
import { redirect } from 'next/navigation';
import { market } from '@/lib/providers/registry';
import { Card, SectionTitle, Unavailable } from '@/components/primitives';
import { resolveBestMatch, searchUniverse } from '@/lib/search/local';

// Live market data: rendered per request against the provider cache layer in
// lib/cache.ts. Static prerendering would bake quotes into the build output and
// spend provider quota at build time.
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? '';

  if (!query) {
    return (
      <div className="animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="mt-2 text-sm text-ink-muted">Enter a ticker, company name or coin.</p>
      </div>
    );
  }

  /**
   * A confident query goes straight to the asset — typing "Bitcoin" and pressing
   * Enter should land on Bitcoin, not on a results page with one row.
   *
   * `resolveBestMatch` only answers on an exact or prefix hit. A weak match
   * returns undefined and falls through to the results list below, because a
   * detail page reached by a coincidental substring looks authoritative and is
   * simply the wrong asset.
   */
  const exact = resolveBestMatch(query);
  if (exact) redirect(`/asset/${exact.kind}/${encodeURIComponent(exact.symbol)}`);

  // Tracked assets are matched in-process, so this list is never empty just
  // because no provider key is configured.
  const local = searchUniverse(query, { limit: 10 });

  const result = await market.search(query);

  return (
    <div className="space-y-6 animate-fade-up">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          Results for <span className="gold-text">{query}</span>
        </h1>
      </section>

      {local.length > 0 ? (
        <section>
          <SectionTitle hint="scoreable now">Tracked assets</SectionTitle>
          <Card className="divide-y divide-glass-border/50">
            {local.map((hit) => (
              <Link
                key={`local-${hit.kind}-${hit.symbol}`}
                href={`/asset/${hit.kind}/${encodeURIComponent(hit.symbol)}`}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-glass"
              >
                <span className="w-20 shrink-0 font-semibold">{hit.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">{hit.name}</span>
                <span className="rounded border border-glass-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
                  {hit.market}
                </span>
              </Link>
            ))}
          </Card>
        </section>
      ) : null}

      {result.ok && result.data.length > 0 ? (
        <Card className="divide-y divide-glass-border/50">
          {result.data.map((hit, i) => (
            <Link
              key={`${hit.source}-${hit.symbol}-${i}`}
              href={`/asset/${hit.kind}/${hit.symbol}`}
              className="flex items-center gap-4 p-4 transition-colors hover:bg-glass"
            >
              <span className="w-20 shrink-0 font-semibold">{hit.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">{hit.name}</span>
              <span className="rounded border border-glass-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
                {hit.kind}
              </span>
            </Link>
          ))}
        </Card>
      ) : local.length === 0 ? (
        <Unavailable
          title="No results"
          reason={
            result.ok
              ? `No instrument matched "${query}".`
              : `Search provider unavailable: ${result.reason}${result.detail ? ` — ${result.detail}` : ''}`
          }
        />
      ) : null}
    </div>
  );
}
