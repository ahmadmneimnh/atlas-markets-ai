/**
 * Domain types for market data, plus the provider contract.
 *
 * Two rules encoded here hold the "never fabricate data" guarantee in place:
 *
 *  1. `ProviderResult` is a discriminated union, not `T | null`. A caller cannot
 *     accidentally treat a missing quote as zero — the compiler forces them to
 *     handle the `ok: false` branch explicitly.
 *  2. Every value carries provenance (`source`, `asOf`). A number that reaches the
 *     UI without knowing where it came from is a bug the type system catches.
 */

/**
 * Listing venues. Mirrors the `Market` enum in the Prisma schema — the two are
 * kept in step by hand, and the seed asserts they agree.
 */
export type Market =
  | 'NYSE'
  | 'NASDAQ'
  | 'AMEX'
  | 'LSE'
  | 'FRA'
  | 'XETRA'
  | 'EURONEXT'
  | 'SIX'
  | 'HKEX'
  | 'TSE'
  | 'SSE'
  | 'SZSE'
  | 'NSE'
  | 'BSE'
  | 'ASX'
  | 'TSX'
  | 'TSXV'
  | 'BVMF'
  | 'JSE'
  | 'CRYPTO';

/**
 * Vendor symbol suffixes per venue.
 *
 * Non-US listings are not addressable by bare ticker: Yahoo and TwelveData want
 * `BP.L`, FMP wants `BP.L` too, Finnhub wants `BP.LON`. A call site that writes
 * the suffix itself has silently bound a query to one vendor, which is exactly
 * what the registry exists to prevent — so the mapping lives with each adapter.
 */
export const MARKET_SUFFIX: Record<Market, string> = {
  NYSE: '',
  NASDAQ: '',
  AMEX: '',
  LSE: '.L',
  FRA: '.F',
  XETRA: '.DE',
  EURONEXT: '.PA',
  SIX: '.SW',
  HKEX: '.HK',
  TSE: '.T',
  SSE: '.SS',
  SZSE: '.SZ',
  NSE: '.NS',
  BSE: '.BO',
  ASX: '.AX',
  TSX: '.TO',
  TSXV: '.V',
  BVMF: '.SA',
  JSE: '.JO',
  CRYPTO: '',
};

export type AssetKind = 'equity' | 'crypto';

export interface AssetRef {
  symbol: string;
  market: Market;
  kind: AssetKind;
}

// ── Values ──────────────────────────────────────────────────────────────────────

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  volume?: number;
  currency?: string;
  /** Provider id that produced this value. */
  source: string;
  /** When the provider observed it. */
  asOf: Date;
}

export interface Candle {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OhlcvSeries {
  symbol: string;
  interval: '1d' | '1h' | '1w';
  candles: Candle[];
  source: string;
  asOf: Date;
}

export interface Fundamentals {
  symbol: string;
  peRatio?: number;
  pegRatio?: number;
  eps?: number;
  revenueGrowthYoY?: number;
  profitMargin?: number;
  freeCashFlow?: number;
  debtToEquity?: number;
  roe?: number;
  roic?: number;
  dividendYield?: number;
  marketCap?: number;
  earningsGrowthYoY?: number;
  institutionalOwnership?: number;
  source: string;
  asOf: Date;
}

export interface CompanyProfile {
  symbol: string;
  name: string;
  exchange?: string;
  country?: string;
  sector?: string;
  industry?: string;
  website?: string;
  logo?: string;
  description?: string;
  source: string;
  asOf: Date;
}

export interface CryptoMetrics {
  symbol: string;
  marketCap?: number;
  circulatingSupply?: number;
  totalSupply?: number;
  maxSupply?: number;
  volume24h?: number;
  /** Rank by market cap. */
  rank?: number;
  /** Developer activity proxies, when the provider exposes them. */
  githubCommits4w?: number;
  githubStars?: number;
  source: string;
  asOf: Date;
}

export interface NewsArticle {
  id: string;
  headline: string;
  summary?: string;
  url: string;
  publishedAt: Date;
  outlet: string;
  source: string;
}

export interface SearchHit {
  symbol: string;
  name: string;
  market: Market;
  kind: AssetKind;
  source: string;
}

// ── Result envelope ─────────────────────────────────────────────────────────────

export type UnavailableReason =
  | 'no_provider_configured'
  | 'not_supported'
  | 'not_found'
  | 'rate_limited'
  | 'upstream_error'
  | 'timeout'
  | 'circuit_open';

export interface Unavailable {
  ok: false;
  reason: UnavailableReason;
  /** Human-readable detail for the admin panel and logs. Never shown as data. */
  detail?: string;
  /** Providers that were tried, for diagnostics. */
  tried?: string[];
}

export interface Available<T> {
  ok: true;
  data: T;
}

export type ProviderResult<T> = Available<T> | Unavailable;

export const ok = <T>(data: T): Available<T> => ({ ok: true, data });
export const unavailable = (reason: UnavailableReason, detail?: string): Unavailable => ({
  ok: false,
  reason,
  ...(detail ? { detail } : {}),
});

// ── Provider contract ───────────────────────────────────────────────────────────

export type Capability =
  | 'quote'
  | 'ohlcv'
  | 'fundamentals'
  | 'profile'
  | 'news'
  | 'crypto.quote'
  | 'crypto.metrics'
  | 'search';

/**
 * A provider declares which capabilities it implements, not what it is. The registry
 * routes by capability, so no call site ever names a vendor — which is what makes a
 * vendor swap a configuration change rather than a refactor.
 */
export interface Provider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: readonly Capability[];
  /** Whether required credentials are present. Unconfigured providers are skipped. */
  isConfigured(): boolean;

  quote?(symbol: string): Promise<ProviderResult<Quote>>;
  ohlcv?(
    symbol: string,
    interval: '1d' | '1h' | '1w',
    limit: number,
  ): Promise<ProviderResult<OhlcvSeries>>;
  fundamentals?(symbol: string): Promise<ProviderResult<Fundamentals>>;
  profile?(symbol: string): Promise<ProviderResult<CompanyProfile>>;
  news?(symbol: string | null, limit: number): Promise<ProviderResult<NewsArticle[]>>;
  cryptoQuote?(symbol: string): Promise<ProviderResult<Quote>>;
  cryptoMetrics?(symbol: string): Promise<ProviderResult<CryptoMetrics>>;
  search?(query: string): Promise<ProviderResult<SearchHit[]>>;
}
