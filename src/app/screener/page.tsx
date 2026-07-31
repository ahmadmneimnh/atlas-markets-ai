import { scoreMany } from '@/lib/service';
import { UNIVERSE, CRYPTO_UNIVERSE } from '@/lib/universe';
import { configuredProviders } from '@/lib/env';
import { Card, SectionTitle, RecommendationBadge, Delta, Provenance, formatPrice, Unavailable } from '@/components/ui';
import Link from 'next/link';
import type { AssetScore } from '@/lib/analysis/types';
import type { Quote } from '@/lib/providers/types';

// Live market data: rendered per request against the provider cache layer in
// lib/cache.ts. Static prerendering would bake quotes into the build output and
// spend provider quota at build time.
export const dynamic = 'force-dynamic';

/**
 * Screener over the tracked universe.
 *
 * Filtering runs server-side over scored results. Only assets that actually
 * scored appear — an asset whose data was unavailable is listed separately rather
 * than shown with blank columns that read as zeros.
 */
export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Promise<{ min?: string; kind?: string }>;
}) {
  const sp = await searchParams;
  const minScore = Number(sp.min ?? '0');
  const kindFilter = sp.kind === 'equity' || sp.kind === 'crypto' ? sp.kind : undefined;

  const providers = configuredProviders();
  const hasEquity = providers['finnhub'] || providers['twelvedata'] || providers['polygon'];
  const universe = hasEquity ? UNIVERSE : CRYPTO_UNIVERSE;

  const results = await scoreMany(
    universe.filter((u) => (kindFilter ? u.kind === kindFilter : true)),
    4,
  );

  const rows = results
    .filter((r) => r.result.ok)
    .map((r) => {
      const res = r.result as { ok: true; score: AssetScore; quote?: Quote };
      const entry = UNIVERSE.find((u) => u.symbol === r.ref.symbol && u.kind === r.ref.kind);
      return { name: entry?.name ?? r.ref.symbol, score: res.score, quote: res.quote };
    })
    .filter((r) => r.score.score >= (Number.isFinite(minScore) ? minScore : 0))
    .sort((a, b) => b.score.score - a.score.score);

  return (
    <div className="space-y-6 animate-fade-up">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Screener</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {rows.length} of {results.length} tracked assets match.
        </p>
      </section>

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-4">
          <label className="text-xs">
            <span className="mb-1.5 block uppercase tracking-wider text-ink-faint">Minimum AI score</span>
            <input
              type="number" name="min" min="0" max="100" defaultValue={sp.min ?? '0'}
              className="tnum w-28 rounded-lg border border-glass-border bg-glass px-3 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1.5 block uppercase tracking-wider text-ink-faint">Asset class</span>
            <select
              name="kind" defaultValue={sp.kind ?? ''}
              className="rounded-lg border border-glass-border bg-glass px-3 py-1.5 text-sm"
            >
              <option value="">All</option>
              <option value="equity">Equities</option>
              <option value="crypto">Crypto</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg border border-gold/30 bg-gold/10 px-4 py-1.5 text-sm font-medium text-gold transition-colors hover:bg-gold/20"
          >
            Apply
          </button>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Unavailable title="No assets match" reason="Lower the minimum score or widen the asset class filter." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-glass-border/60 text-left text-[10px] uppercase tracking-wider text-ink-faint">
                <th className="p-4 font-medium">Symbol</th>
                <th className="p-4 font-medium">Price</th>
                <th className="p-4 font-medium">24h</th>
                <th className="p-4 font-medium">AI score</th>
                <th className="p-4 font-medium">Confidence</th>
                <th className="p-4 font-medium">Rating</th>
                <th className="p-4 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-glass-border/40">
              {rows.map((r) => (
                <tr key={`${r.score.ref.kind}-${r.score.ref.symbol}`} className="transition-colors hover:bg-glass">
                  <td className="p-4">
                    <Link href={`/asset/${r.score.ref.kind}/${r.score.ref.symbol}`} className="block">
                      <span className="font-semibold">{r.score.ref.symbol}</span>
                      <span className="ml-2 text-xs text-ink-faint">{r.name}</span>
                    </Link>
                  </td>
                  <td className="tnum p-4">{r.quote ? `$${formatPrice(r.quote.price)}` : <span className="text-ink-faint">—</span>}</td>
                  <td className="p-4">{r.quote ? <Delta value={r.quote.changePercent} /> : <span className="text-ink-faint">—</span>}</td>
                  <td className="tnum p-4 font-semibold">{r.score.score.toFixed(1)}</td>
                  <td className="tnum p-4 text-ink-muted">{r.score.confidence}%</td>
                  <td className="p-4"><RecommendationBadge recommendation={r.score.recommendation} size="sm" /></td>
                  <td className="p-4">{r.quote ? <Provenance source={r.quote.source} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
