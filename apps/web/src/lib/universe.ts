import type { AssetRef } from './providers/types';

/**
 * The default tracked universe.
 *
 * This is *identifier metadata* — ticker, venue, display name — not market data.
 * No price, volume or valuation appears here; those are always fetched. In a full
 * deployment this table is seeded into the `Asset` table and maintained from each
 * exchange's listing feed, and this file becomes the bootstrap seed.
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
  // ── United States ─────────────────────────────────────────────────────────
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

  // ── London ────────────────────────────────────────────────────────────────
  { symbol: 'SHEL', name: 'Shell plc', market: 'LSE', kind: 'equity' },
  { symbol: 'AZN', name: 'AstraZeneca plc', market: 'LSE', kind: 'equity' },
  { symbol: 'HSBA', name: 'HSBC Holdings plc', market: 'LSE', kind: 'equity' },
  { symbol: 'ULVR', name: 'Unilever plc', market: 'LSE', kind: 'equity' },

  // ── Frankfurt / XETRA ─────────────────────────────────────────────────────
  { symbol: 'SAP', name: 'SAP SE', market: 'XETRA', kind: 'equity' },
  { symbol: 'SIE', name: 'Siemens AG', market: 'XETRA', kind: 'equity' },
  { symbol: 'ALV', name: 'Allianz SE', market: 'XETRA', kind: 'equity' },

  // ── Hong Kong ─────────────────────────────────────────────────────────────
  // Numeric tickers are the venue's real identifiers, zero-padded to four
  // digits. Trimming the padding produces a symbol no provider recognises.
  { symbol: '0700', name: 'Tencent Holdings Ltd.', market: 'HKEX', kind: 'equity' },
  { symbol: '0941', name: 'China Mobile Ltd.', market: 'HKEX', kind: 'equity' },
  { symbol: '1299', name: 'AIA Group Ltd.', market: 'HKEX', kind: 'equity' },

  // ── Tokyo ─────────────────────────────────────────────────────────────────
  { symbol: '7203', name: 'Toyota Motor Corp.', market: 'TSE', kind: 'equity' },
  { symbol: '6758', name: 'Sony Group Corp.', market: 'TSE', kind: 'equity' },
  { symbol: '9984', name: 'SoftBank Group Corp.', market: 'TSE', kind: 'equity' },

  // ── Australia ─────────────────────────────────────────────────────────────
  { symbol: 'BHP', name: 'BHP Group Ltd.', market: 'ASX', kind: 'equity' },
  { symbol: 'CBA', name: 'Commonwealth Bank of Australia', market: 'ASX', kind: 'equity' },
  { symbol: 'CSL', name: 'CSL Ltd.', market: 'ASX', kind: 'equity' },

  // ── Canada ────────────────────────────────────────────────────────────────
  { symbol: 'RY', name: 'Royal Bank of Canada', market: 'TSX', kind: 'equity' },
  { symbol: 'SHOP', name: 'Shopify Inc.', market: 'TSX', kind: 'equity' },
  { symbol: 'ENB', name: 'Enbridge Inc.', market: 'TSX', kind: 'equity' },
];

export const UNIVERSE: UniverseEntry[] = [...CRYPTO_UNIVERSE, ...EQUITY_UNIVERSE];

export function findAsset(symbol: string, kind?: 'equity' | 'crypto'): UniverseEntry | undefined {
  const upper = symbol.toUpperCase();
  return UNIVERSE.find((a) => a.symbol === upper && (kind ? a.kind === kind : true));
}

/** The tracked universe grouped by venue, for the dashboard's market sections. */
export function byMarket(): Map<UniverseEntry['market'], UniverseEntry[]> {
  const grouped = new Map<UniverseEntry['market'], UniverseEntry[]>();
  for (const entry of UNIVERSE) {
    const bucket = grouped.get(entry.market);
    if (bucket) bucket.push(entry);
    else grouped.set(entry.market, [entry]);
  }
  return grouped;
}
