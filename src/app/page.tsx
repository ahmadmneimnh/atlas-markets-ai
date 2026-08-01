import { market } from '@/lib/providers/registry';
import { coverage } from '@/lib/env';
import { toRowDTO, type AssetRowDTO } from '@/lib/dto';
import { trackedUniverse } from '@/lib/universe';
import { MarketDashboard } from '@/components/market-dashboard';

// Live market data: rendered per request against the cache in lib/cache.ts. Static
// prerendering would bake prices into the build output and spend provider quota at
// build time.
export const dynamic = 'force-dynamic';

/** How often the dashboard re-polls. Comfortably inside every free tier's limit. */
const REFRESH_MS = 30_000;

export default async function DashboardPage() {
  const refs = trackedUniverse();
  const results = await market.quotes(refs);

  // Server-rendered first paint, so the page is useful before any JavaScript runs;
  // the client component takes over refreshing from here.
  const rows: AssetRowDTO[] = results.map((r, i) => {
    const ref = refs[i]!;
    return toRowDTO({ symbol: ref.symbol, name: ref.name, kind: ref.kind }, r.result);
  });

  const cover = coverage();

  return (
    <div className="animate-fade-up space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Batal&apos;s Brain
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Live cryptocurrency and stock prices, pulled straight from public market data
          providers. Search any symbol for its chart and details. Nothing on this page is
          simulated — if a source cannot supply a figure, the app says so.
        </p>
      </section>

      <MarketDashboard initial={{ rows }} refreshMs={REFRESH_MS} stocksConfigured={cover.stocks} />
    </div>
  );
}
