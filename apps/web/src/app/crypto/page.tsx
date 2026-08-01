import { MarketSection } from '@/components/dashboard/market-section';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Cryptocurrency — Atlas Markets AI' };

export default function CryptoPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          ₿ <span className="gold-text">Cryptocurrency</span>
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Scored from CoinGecko, Binance, Coinbase and CoinMarketCap — no API key required.
        </p>
      </div>
      <MarketSection kind="crypto" />
    </div>
  );
}
