import { MarketSection } from '@/components/dashboard/market-section';

// Live market data, rendered per request against the provider cache layer.
// Static prerendering would bake quotes into the build output and spend provider
// quota at build time.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Stock Market — Atlas Markets AI' };

export default function StocksPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          📈 Stock <span className="gold-text">Market</span>
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          NYSE, NASDAQ, London, Frankfurt, Hong Kong, Tokyo, Sydney and Toronto.
        </p>
      </div>
      <MarketSection kind="equity" />
    </div>
  );
}
