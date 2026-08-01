import 'server-only';

/**
 * Server-only configuration.
 *
 * Every credential is optional by design: the app must run with zero keys set and
 * simply report which parts of the market it cannot cover. That is what makes the
 * "never invent data" rule enforceable — an unconfigured provider degrades to an
 * explicit "Insufficient Data" instead of a fallback that makes numbers up.
 *
 * This module imports `server-only`, so any accidental import from a client
 * component fails the build rather than shipping an API key to the browser.
 */

function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  // Treat empty and common placeholder values as absent. A key left as
  // "your-key-here" would otherwise produce confusing 401s at runtime instead of
  // an honest "not configured".
  if (trimmed === '' || /^(your|changeme|xxx|todo|paste)/i.test(trimmed)) return undefined;
  return trimmed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',

  providers: {
    /** Stocks: quotes, company profiles, key statistics, search. */
    finnhub: read('FINNHUB_API_KEY'),
    /** Stocks: daily price history for the charts. Optional but recommended. */
    alphaVantage: read('ALPHA_VANTAGE_API_KEY'),
    /** Crypto: optional. CoinGecko's public tier works without a key. */
    coinGecko: read('COINGECKO_API_KEY'),
  },

  /**
   * Provider preference per capability, highest priority first. This is the swap
   * seam: changing which vendor serves a capability is a config change, not a code
   * change. e.g. BB_PRIORITY_CRYPTO_QUOTE="coingecko,binance"
   */
  priority: {
    quote: parseList(read('BB_PRIORITY_QUOTE')),
    cryptoQuote: parseList(read('BB_PRIORITY_CRYPTO_QUOTE')),
    ohlcv: parseList(read('BB_PRIORITY_OHLCV')),
    cryptoOhlcv: parseList(read('BB_PRIORITY_CRYPTO_OHLCV')),
  },
} as const;

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Which data sources have what they need. Surfaced in the UI so a user who has not
 * added a key is told exactly which key is missing, rather than seeing a blank page.
 */
export function coverage() {
  return {
    /** Crypto works on a fresh clone: both crypto sources are keyless. */
    crypto: true,
    /** Stock quotes, profiles and statistics. */
    stocks: Boolean(env.providers.finnhub),
    /** Stock price history (the charts on a stock's page). */
    stockCharts: Boolean(env.providers.alphaVantage),
  };
}
