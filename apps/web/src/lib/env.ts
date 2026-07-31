import 'server-only';

/**
 * Server-only configuration.
 *
 * Every provider credential is optional by design: the platform must run with zero
 * keys configured and simply report which capabilities are unavailable. That is what
 * makes "never fabricate data" enforceable — an unconfigured provider degrades to an
 * explicit absence rather than to a fallback that invents numbers.
 */

function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  // Treat empty and common placeholder values as absent. A key of "your-key-here"
  // left in a .env file would otherwise produce confusing 401s at runtime instead of
  // an honest "not configured".
  if (trimmed === '' || /^(your|changeme|xxx|todo)/i.test(trimmed)) return undefined;
  return trimmed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  siteUrl: read('NEXT_PUBLIC_SITE_URL') ?? 'http://localhost:3000',

  databaseUrl: read('DATABASE_URL'),
  redisUrl: read('REDIS_URL'),

  providers: {
    finnhub: read('FINNHUB_API_KEY'),
    alphaVantage: read('ALPHA_VANTAGE_API_KEY'),
    twelveData: read('TWELVE_DATA_API_KEY'),
    fmp: read('FMP_API_KEY'),
    polygon: read('POLYGON_API_KEY'),
    coinGecko: read('COINGECKO_API_KEY'), // optional: public tier needs no key
    coinMarketCap: read('COINMARKETCAP_API_KEY'),
    newsApi: read('NEWSAPI_KEY'),
  },

  /**
   * Provider preference per capability, highest priority first. This is the swap seam:
   * changing which vendor serves quotes is an env change, not a code change.
   * e.g. ATLAS_PRIORITY_QUOTE="twelvedata,finnhub"
   */
  priority: {
    quote: parseList(read('ATLAS_PRIORITY_QUOTE')),
    ohlcv: parseList(read('ATLAS_PRIORITY_OHLCV')),
    fundamentals: parseList(read('ATLAS_PRIORITY_FUNDAMENTALS')),
    news: parseList(read('ATLAS_PRIORITY_NEWS')),
  },
} as const;

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Which providers have credentials. Surfaced in the admin panel and setup screens. */
export function configuredProviders(): Record<string, boolean> {
  return {
    finnhub: Boolean(env.providers.finnhub),
    alphavantage: Boolean(env.providers.alphaVantage),
    twelvedata: Boolean(env.providers.twelveData),
    fmp: Boolean(env.providers.fmp),
    polygon: Boolean(env.providers.polygon),
    coingecko: true, // public tier works without a key
    coinmarketcap: Boolean(env.providers.coinMarketCap),
    binance: true, // public market data endpoints are unauthenticated
    newsapi: Boolean(env.providers.newsApi),
  };
}
