import { env } from '@/lib/env';
import { fetchJson, HttpError, RateLimitedError, CircuitOpenError } from '@/lib/http';
import type {
  Provider, ProviderResult, Quote, CompanyProfile, Fundamentals, NewsArticle, SearchHit, Market,
} from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';
import { setNumber } from '../util';

const BASE = 'https://finnhub.io/api/v1';
// Free tier is 60 calls/minute; we sit just under it to leave headroom for bursts.
const LIMIT = { requests: 55, windowMs: 60_000 };

interface FinnhubQuote { c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number }
interface FinnhubProfile {
  name?: string; country?: string; currency?: string; exchange?: string;
  finnhubIndustry?: string; logo?: string; weburl?: string; marketCapitalization?: number;
}
interface FinnhubMetric { metric?: Record<string, number | string | null> }
interface FinnhubNews { id: number; headline: string; summary: string; url: string; datetime: number; source: string }
interface FinnhubSearch { result?: { symbol: string; description: string; type: string }[] }

function url(path: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, token: env.providers.finnhub ?? '' });
  return `${BASE}${path}?${q}`;
}

/** Finnhub reports metrics as numbers or numeric strings depending on the field. */
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export const finnhub: Provider = {
  id: 'finnhub',
  label: 'Finnhub',
  capabilities: ['quote', 'profile', 'fundamentals', 'news', 'search'],

  isConfigured: () => Boolean(env.providers.finnhub),

  async quote(symbol: string): Promise<ProviderResult<Quote>> {
    try {
      const r = await fetchJson<FinnhubQuote>({
        provider: 'finnhub',
        url: url('/quote', { symbol }),
        rateLimit: LIMIT,
      });
      // Finnhub returns 200 with an all-zero payload for unknown symbols rather
      // than a 404. Treating that as a real quote would put a $0.00 price on screen.
      if (!r || r.c === 0) return unavailable('not_found', `no quote for ${symbol}`);

      return ok({
        symbol,
        price: r.c,
        change: r.d,
        changePercent: r.dp,
        open: r.o,
        high: r.h,
        low: r.l,
        previousClose: r.pc,
        source: 'finnhub',
        asOf: r.t ? new Date(r.t * 1000) : new Date(),
      });
    } catch (e) {
      return classifyError(e);
    }
  },

  async profile(symbol: string): Promise<ProviderResult<CompanyProfile>> {
    try {
      const r = await fetchJson<FinnhubProfile>({
        provider: 'finnhub',
        url: url('/stock/profile2', { symbol }),
        rateLimit: LIMIT,
      });
      if (!r?.name) return unavailable('not_found', `no profile for ${symbol}`);

      return ok({
        symbol,
        name: r.name,
        ...(r.exchange ? { exchange: r.exchange } : {}),
        ...(r.country ? { country: r.country } : {}),
        ...(r.finnhubIndustry ? { industry: r.finnhubIndustry, sector: r.finnhubIndustry } : {}),
        ...(r.weburl ? { website: r.weburl } : {}),
        ...(r.logo ? { logo: r.logo } : {}),
        source: 'finnhub',
        asOf: new Date(),
      });
    } catch (e) {
      return classifyError(e);
    }
  },

  async fundamentals(symbol: string): Promise<ProviderResult<Fundamentals>> {
    try {
      const r = await fetchJson<FinnhubMetric>({
        provider: 'finnhub',
        url: url('/stock/metric', { symbol, metric: 'all' }),
        rateLimit: LIMIT,
      });
      const m = r?.metric;
      if (!m) return unavailable('not_found', `no metrics for ${symbol}`);

      // Every field is optional: partial fundamentals are normal on the free tier,
      // and the scoring engine handles missing inputs by lowering confidence rather
      // than substituting a value.
      const out: Fundamentals = {
        symbol,
        source: 'finnhub',
        asOf: new Date(),
      };
      setNumber(out, 'peRatio', num(m['peTTM']) ?? num(m['peBasicExclExtraTTM']));
      setNumber(out, 'pegRatio', num(m['pegTTM']));
      setNumber(out, 'eps', num(m['epsTTM']) ?? num(m['epsBasicExclExtraItemsTTM']));
      setNumber(out, 'revenueGrowthYoY', num(m['revenueGrowthTTMYoy']));
      setNumber(out, 'profitMargin', num(m['netProfitMarginTTM']));
      setNumber(out, 'debtToEquity', num(m['totalDebt/totalEquityQuarterly']));
      setNumber(out, 'roe', num(m['roeTTM']));
      setNumber(out, 'roic', num(m['roicTTM']));
      setNumber(out, 'dividendYield', num(m['dividendYieldIndicatedAnnual']));
      // Finnhub reports market capitalisation in millions; the domain type is in
      // whole currency units.
      const capMillions = num(m['marketCapitalization']);
      setNumber(out, 'marketCap', capMillions === undefined ? undefined : capMillions * 1e6);
      setNumber(out, 'earningsGrowthYoY', num(m['epsGrowthTTMYoy']));
      setNumber(out, 'freeCashFlow', num(m['freeCashFlowTTM']));

      return ok(out);
    } catch (e) {
      return classifyError(e);
    }
  },

  async news(symbol: string | null, limit: number): Promise<ProviderResult<NewsArticle[]>> {
    if (!symbol) return unavailable('not_supported', 'finnhub company-news requires a symbol');
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
      const iso = (d: Date) => d.toISOString().slice(0, 10);

      const r = await fetchJson<FinnhubNews[]>({
        provider: 'finnhub',
        url: url('/company-news', { symbol, from: iso(from), to: iso(to) }),
        rateLimit: LIMIT,
      });
      if (!Array.isArray(r)) return unavailable('upstream_error', 'unexpected news payload');

      return ok(
        r.slice(0, limit).map((a) => ({
          id: String(a.id),
          headline: a.headline,
          summary: a.summary,
          url: a.url,
          publishedAt: new Date(a.datetime * 1000),
          outlet: a.source,
          source: 'finnhub',
        })),
      );
    } catch (e) {
      return classifyError(e);
    }
  },

  async search(query: string): Promise<ProviderResult<SearchHit[]>> {
    try {
      const r = await fetchJson<FinnhubSearch>({
        provider: 'finnhub',
        url: url('/search', { q: query }),
        rateLimit: LIMIT,
      });
      const hits = (r?.result ?? [])
        .filter((h) => h.type === 'Common Stock' || h.type === '')
        .slice(0, 20)
        .map((h) => ({
          symbol: h.symbol,
          name: h.description,
          // Finnhub's search does not return the listing venue; the market is
          // resolved from the Asset record when the symbol is persisted.
          market: 'NASDAQ' as Market,
          kind: 'equity' as const,
          source: 'finnhub',
        }));
      return ok(hits);
    } catch (e) {
      return classifyError(e);
    }
  },
};

// Re-exported for adapters that need the same error taxonomy.
export { HttpError, RateLimitedError, CircuitOpenError };
