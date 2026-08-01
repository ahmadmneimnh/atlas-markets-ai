import { env } from '@/lib/env';
import { fetchJson } from '@/lib/http';
import type {
  Provider, ProviderResult, Quote, CryptoMetrics, SearchHit, OhlcvSeries, Candle,
} from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';
import { setNumber } from '../util';

/**
 * CoinGecko. The public tier needs no key, which makes it the one provider that
 * works out of the box — so it is the default first choice for crypto capabilities.
 */

const PUBLIC_BASE = 'https://api.coingecko.com/api/v3';
const PRO_BASE = 'https://pro-api.coingecko.com/api/v3';

// Public tier is roughly 10-30 calls/min and enforced aggressively; stay conservative.
const PUBLIC_LIMIT = { requests: 8, windowMs: 60_000 };
const PRO_LIMIT = { requests: 400, windowMs: 60_000 };

/**
 * Ticker → CoinGecko id for the majors. This is static metadata (an identifier
 * mapping), not market data, so hardcoding it does not violate the no-fabrication
 * rule. Anything not listed resolves through /search at runtime.
 */
const COIN_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple',
  BNB: 'binancecoin', ADA: 'cardano', DOGE: 'dogecoin', AVAX: 'avalanche-2',
  DOT: 'polkadot', MATIC: 'matic-network', LINK: 'chainlink', LTC: 'litecoin',
  TRX: 'tron', SHIB: 'shiba-inu', UNI: 'uniswap', ATOM: 'cosmos',
  XLM: 'stellar', BCH: 'bitcoin-cash', NEAR: 'near', APT: 'aptos',
  ARB: 'arbitrum', OP: 'optimism', TON: 'the-open-network', ICP: 'internet-computer',
};

const isPro = () => Boolean(env.providers.coinGecko);
const base = () => (isPro() ? PRO_BASE : PUBLIC_BASE);
const limit = () => (isPro() ? PRO_LIMIT : PUBLIC_LIMIT);
const headers = (): Record<string, string> =>
  isPro() ? { 'x-cg-pro-api-key': env.providers.coinGecko as string } : {};

interface MarketRow {
  id: string; symbol: string; name: string;
  current_price: number; price_change_24h: number; price_change_percentage_24h: number;
  high_24h: number; low_24h: number; total_volume: number; market_cap: number;
  circulating_supply: number; total_supply: number | null; max_supply: number | null;
  market_cap_rank: number; last_updated: string;
}

interface CoinDetail {
  id: string; symbol: string; name: string;
  market_cap_rank?: number;
  developer_data?: { stars?: number; commit_count_4_weeks?: number };
  market_data?: {
    current_price?: Record<string, number>;
    market_cap?: Record<string, number>;
    total_volume?: Record<string, number>;
    circulating_supply?: number; total_supply?: number | null; max_supply?: number | null;
    price_change_24h?: number; price_change_percentage_24h?: number;
    high_24h?: Record<string, number>; low_24h?: Record<string, number>;
  };
  last_updated?: string;
}

async function resolveId(symbol: string): Promise<string | null> {
  const known = COIN_IDS[symbol.toUpperCase()];
  if (known) return known;

  const r = await fetchJson<{ coins?: { id: string; symbol: string }[] }>({
    provider: 'coingecko',
    url: `${base()}/search?query=${encodeURIComponent(symbol)}`,
    headers: headers(),
    rateLimit: limit(),
  });
  const exact = r.coins?.find((c) => c.symbol.toLowerCase() === symbol.toLowerCase());
  return exact?.id ?? r.coins?.[0]?.id ?? null;
}

export const coingecko: Provider = {
  id: 'coingecko',
  label: 'CoinGecko',
  capabilities: ['crypto.quote', 'crypto.metrics', 'crypto.ohlcv', 'search'],

  // Public tier requires no credential, so this provider is always available.
  isConfigured: () => true,

  async cryptoQuote(symbol: string): Promise<ProviderResult<Quote>> {
    try {
      const id = await resolveId(symbol);
      if (!id) return unavailable('not_found', `unknown coin ${symbol}`);

      const rows = await fetchJson<MarketRow[]>({
        provider: 'coingecko',
        url: `${base()}/coins/markets?vs_currency=usd&ids=${id}`,
        headers: headers(),
        rateLimit: limit(),
      });
      const r = rows?.[0];
      if (!r) return unavailable('not_found', `no market row for ${symbol}`);

      return ok({
        symbol: symbol.toUpperCase(),
        price: r.current_price,
        change: r.price_change_24h,
        changePercent: r.price_change_percentage_24h,
        high: r.high_24h,
        low: r.low_24h,
        volume: r.total_volume,
        currency: 'USD',
        source: 'coingecko',
        asOf: r.last_updated ? new Date(r.last_updated) : new Date(),
      });
    } catch (e) {
      return classifyError(e);
    }
  },

  async cryptoMetrics(symbol: string): Promise<ProviderResult<CryptoMetrics>> {
    try {
      const id = await resolveId(symbol);
      if (!id) return unavailable('not_found', `unknown coin ${symbol}`);

      const r = await fetchJson<CoinDetail>({
        provider: 'coingecko',
        // Trim the payload: the full document is several hundred KB per coin.
        url: `${base()}/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=true&sparkline=false`,
        headers: headers(),
        rateLimit: limit(),
      });
      const md = r.market_data;
      if (!md) return unavailable('not_found', `no market data for ${symbol}`);

      const out: CryptoMetrics = { symbol: symbol.toUpperCase(), source: 'coingecko', asOf: new Date() };
      setNumber(out, 'marketCap', md.market_cap?.['usd']);
      setNumber(out, 'volume24h', md.total_volume?.['usd']);
      setNumber(out, 'circulatingSupply', md.circulating_supply);
      setNumber(out, 'totalSupply', md.total_supply);
      setNumber(out, 'maxSupply', md.max_supply);
      setNumber(out, 'rank', r.market_cap_rank);
      setNumber(out, 'githubCommits4w', r.developer_data?.commit_count_4_weeks);
      setNumber(out, 'githubStars', r.developer_data?.stars);

      return ok(out);
    } catch (e) {
      return classifyError(e);
    }
  },

  async ohlcv(symbol: string, interval, limitCount: number): Promise<ProviderResult<OhlcvSeries>> {
    if (interval !== '1d') return unavailable('not_supported', 'coingecko adapter serves daily bars only');
    try {
      const id = await resolveId(symbol);
      if (!id) return unavailable('not_found', `unknown coin ${symbol}`);

      const days = Math.min(365, Math.max(30, limitCount));
      // /ohlc returns [timestamp, o, h, l, c] — no volume, so volume is reported as 0
      // and the indicators that need it (VWAP, volume trend) are skipped rather than
      // computed from a stand-in value.
      const rows = await fetchJson<[number, number, number, number, number][]>({
        provider: 'coingecko',
        url: `${base()}/coins/${id}/ohlc?vs_currency=usd&days=${days}`,
        headers: headers(),
        rateLimit: limit(),
      });
      if (!Array.isArray(rows) || rows.length === 0) {
        return unavailable('not_found', `no OHLC for ${symbol}`);
      }

      const candles: Candle[] = rows.map(([t, o, h, l, c]) => ({
        time: new Date(t), open: o, high: h, low: l, close: c, volume: 0,
      }));

      return ok({
        symbol: symbol.toUpperCase(),
        interval: '1d',
        candles: candles.slice(-limitCount),
        source: 'coingecko',
        asOf: new Date(),
      });
    } catch (e) {
      return classifyError(e);
    }
  },

  async search(query: string): Promise<ProviderResult<SearchHit[]>> {
    try {
      const r = await fetchJson<{ coins?: { symbol: string; name: string }[] }>({
        provider: 'coingecko',
        url: `${base()}/search?query=${encodeURIComponent(query)}`,
        headers: headers(),
        rateLimit: limit(),
      });
      return ok(
        (r.coins ?? []).slice(0, 15).map((c) => ({
          symbol: c.symbol.toUpperCase(),
          name: c.name,
          market: 'CRYPTO' as const,
          kind: 'crypto' as const,
          source: 'coingecko',
        })),
      );
    } catch (e) {
      return classifyError(e);
    }
  },
};
