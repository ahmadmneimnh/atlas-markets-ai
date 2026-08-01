import { coverage } from './env';
import type { AssetRef } from './providers/types';

/**
 * The default tracked list shown on the dashboard.
 *
 * This is *identifier metadata* — ticker, venue, display name — not market data. No
 * price, volume or valuation appears here; those are always fetched live. Searching
 * reaches every symbol the providers know about; this list only decides what the
 * homepage shows before you search for anything.
 */

export interface UniverseEntry extends AssetRef {
  name: string;
}

export const CRYPTO_UNIVERSE: UniverseEntry[] = [
  { symbol: 'BTC', name: 'Bitcoin', market: 'CRYPTO', kind: 'crypto' },
  { symbol: 'ETH', name: 'Ethereum', market: 'CRYPTO', kind: 'crypto' },
  { symbol: 'SOL', name: 'Solana', market: 'CRYPTO', kind: 'crypto' },
  { symbol: 'XRP', name: 'XRP', market: 'CRYPTO', kind: 'crypto' },
  { symbol: 'BNB', name: 'BNB', market: 'CRYPTO', kind: 'crypto' },
  { symbol: 'ADA', name: 'Cardano', market: 'CRYPTO', kind: 'crypto' },
  { symbol: 'DOGE', name: 'Dogecoin', market: 'CRYPTO', kind: 'crypto' },
  { symbol: 'AVAX', name: 'Avalanche', market: 'CRYPTO', kind: 'crypto' },
  { symbol: 'LINK', name: 'Chainlink', market: 'CRYPTO', kind: 'crypto' },
  { symbol: 'DOT', name: 'Polkadot', market: 'CRYPTO', kind: 'crypto' },
];

export const EQUITY_UNIVERSE: UniverseEntry[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', market: 'NASDAQ', kind: 'equity' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', market: 'NASDAQ', kind: 'equity' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', market: 'NASDAQ', kind: 'equity' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', market: 'NASDAQ', kind: 'equity' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', market: 'NASDAQ', kind: 'equity' },
  { symbol: 'META', name: 'Meta Platforms Inc.', market: 'NASDAQ', kind: 'equity' },
  { symbol: 'TSLA', name: 'Tesla Inc.', market: 'NASDAQ', kind: 'equity' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', market: 'NYSE', kind: 'equity' },
  { symbol: 'V', name: 'Visa Inc.', market: 'NYSE', kind: 'equity' },
  { symbol: 'WMT', name: 'Walmart Inc.', market: 'NYSE', kind: 'equity' },
];

export const UNIVERSE: UniverseEntry[] = [...CRYPTO_UNIVERSE, ...EQUITY_UNIVERSE];

/**
 * What the dashboard should try to price right now.
 *
 * Stocks are omitted when no stock provider is configured — requesting ten quotes
 * that are all guaranteed to fail would add a second of latency to every refresh to
 * produce ten identical error rows. The dashboard shows one clear "Insufficient
 * Data" panel for the whole section instead.
 */
export function trackedUniverse(): UniverseEntry[] {
  return coverage().stocks ? UNIVERSE : CRYPTO_UNIVERSE;
}

export function findAsset(symbol: string, kind?: 'equity' | 'crypto'): UniverseEntry | undefined {
  const upper = symbol.toUpperCase();
  return UNIVERSE.find((a) => a.symbol === upper && (kind ? a.kind === kind : true));
}
