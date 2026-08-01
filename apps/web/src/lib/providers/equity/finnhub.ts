import { env } from '@/lib/env';
import { fetchJson, HttpError, RateLimitedError, CircuitOpenError } from '@/lib/http';
import type {
  Provider,
  ProviderResult,
  Quote,
  CompanyProfile,
  Fundamentals,
  NewsArticle,
  SearchHit,
  Market,
  EarningsEvent,
  EconomicEvent,
} from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';
import { setNumber } from '../util';

const BASE = 'https://finnhub.io/api/v1';
// Free tier is 60 calls/minute; we sit just under it to leave headroom for bursts.
const LIMIT = { requests: 55, windowMs: 60_000 };

interface FinnhubQuote {
  c: number;
  d: number;
  dp: number;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
}
interface FinnhubProfile {
  name?: string;
  country?: string;
  currency?: string;
  exchange?: string;
  finnhubIndustry?: string;
  logo?: string;
  weburl?: string;
  marketCapitalization?: number;
}
interface FinnhubMetric {
  metric?: Record<string, number | string | null>;
}
interface FinnhubNews {
  id: number;
  headline: string;
  summary: string;
  url: string;
  datetime: number;
  source: string;
}
interface FinnhubSearch {
  result?: { symbol: string; description: string; type: string }[];
}
interface FinnhubEarningsCalendar {
  earningsCalendar?: {
    symbol: string;
    date: string;
    hour?: string;
    quarter?: number;
    year?: number;
    epsEstimate?: number | null;
    epsActual?: number | null;
    revenueEstimate?: number | null;
    revenueActual?: number | null;
  }[];
}
interface FinnhubEconomicCalendar {
  economicCalendar?: {
    country: string;
    event: string;
    time: string;
    impact?: string;
    actual?: number | null;
    estimate?: number | null;
    prev?: number | null;
    unit?: string;
  }[];
}

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
  capabilities: [
    'quote',
    'profile',
    'fundamentals',
    'news',
    'search',
    'earnings',
    'economic.calendar',
  ],

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
      setNumber(out, 'marketCap', num(m['marketCapitalization']));
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

  async earnings(from: string, to: string): Promise<ProviderResult<EarningsEvent[]>> {
    try {
      const r = await fetchJson<FinnhubEarningsCalendar>({
        provider: 'finnhub',
        url: url('/calendar/earnings', { from, to }),
        rateLimit: LIMIT,
      });

      const rows = r?.earningsCalendar ?? [];
      if (rows.length === 0) return unavailable('not_found', 'no earnings in window');

      return ok(
        rows
          .map((row): EarningsEvent => {
            const event: EarningsEvent = {
              symbol: row.symbol,
              // Finnhub dates are exchange-local calendar days with no time. Parsed
              // as UTC midnight so the date is stable; rendering it in a local
              // timezone would shift some entries by a day.
              date: new Date(`${row.date}T00:00:00Z`),
              source: 'finnhub',
            };
            if (row.hour === 'bmo' || row.hour === 'amc' || row.hour === 'dmh') {
              event.hour = row.hour;
            }
            setNumber(event, 'quarter', row.quarter);
            setNumber(event, 'year', row.year);
            // epsEstimate and epsActual stay distinct. Collapsing them would make
            // a forecast indistinguishable from a result.
            setNumber(event, 'epsEstimate', row.epsEstimate);
            setNumber(event, 'epsActual', row.epsActual);
            setNumber(event, 'revenueEstimate', row.revenueEstimate);
            setNumber(event, 'revenueActual', row.revenueActual);
            return event;
          })
          .sort((a, b) => a.date.getTime() - b.date.getTime()),
      );
    } catch (e) {
      return classifyError(e);
    }
  },

  async economicCalendar(from: string, to: string): Promise<ProviderResult<EconomicEvent[]>> {
    try {
      const r = await fetchJson<FinnhubEconomicCalendar>({
        provider: 'finnhub',
        url: url('/calendar/economic', { from, to }),
        rateLimit: LIMIT,
      });

      const rows = r?.economicCalendar ?? [];
      // This endpoint is premium-only. Finnhub answers a free key with 200 and an
      // empty body rather than 403, so "empty" here means "not on your plan" far
      // more often than "no releases this week" — and the UI says exactly that
      // instead of rendering a convincingly empty calendar.
      if (rows.length === 0) {
        return unavailable(
          'not_supported',
          'Finnhub returns an empty economic calendar on free plans; a premium key is required.',
        );
      }

      return ok(
        rows
          .map((row): EconomicEvent => {
            const event: EconomicEvent = {
              id: `${row.country}-${row.event}-${row.time}`,
              event: row.event,
              country: row.country,
              time: new Date(row.time.replace(' ', 'T') + 'Z'),
              source: 'finnhub',
            };
            const impact = row.impact?.toLowerCase();
            if (impact === 'low' || impact === 'medium' || impact === 'high') {
              event.impact = impact;
            }
            setNumber(event, 'actual', row.actual);
            setNumber(event, 'estimate', row.estimate);
            setNumber(event, 'previous', row.prev);
            if (row.unit) event.unit = row.unit;
            return event;
          })
          .sort((a, b) => a.time.getTime() - b.time.getTime()),
      );
    } catch (e) {
      return classifyError(e);
    }
  },
};

// Re-exported for adapters that need the same error taxonomy.
export { HttpError, RateLimitedError, CircuitOpenError };

/**
 * Ownership and insider activity.
 *
 * Kept outside the `Provider` contract for the same reason as FMP's statements:
 * Finnhub is the only configured source, so a routed capability would have a
 * fallthrough list of length one. The detail page calls these directly and
 * renders an explicit unavailable state when no key is set.
 *
 * Both endpoints are premium on Finnhub's pricing. A free key gets HTTP 403 or a
 * 200 with an empty array depending on the endpoint, and both are reported as
 * `not_supported` with the reason rather than as "this company has no insider
 * activity" — which is what an empty list on screen would mean to a reader.
 */
export interface InsiderTransaction {
  name: string;
  share: number;
  change: number;
  filingDate: Date;
  transactionDate: Date;
  transactionPrice?: number;
  transactionCode?: string;
  source: string;
}

export interface InstitutionalHolder {
  name: string;
  share: number;
  change: number;
  filingDate: Date;
  portfolioPercent?: number;
  source: string;
}

interface FinnhubInsiderResponse {
  data?: {
    name: string;
    share: number;
    change: number;
    filingDate: string;
    transactionDate: string;
    transactionPrice?: number;
    transactionCode?: string;
  }[];
}

interface FinnhubOwnershipResponse {
  ownership?: {
    name: string;
    share: number;
    change: number;
    filingDate: string;
    portfolioPercent?: number;
  }[];
}

export const finnhubExtras = {
  isConfigured: () => Boolean(env.providers.finnhub),

  async insiderTransactions(symbol: string): Promise<ProviderResult<InsiderTransaction[]>> {
    if (!env.providers.finnhub) {
      return unavailable('no_provider_configured', 'FINNHUB_API_KEY is not set');
    }
    try {
      const r = await fetchJson<FinnhubInsiderResponse>({
        provider: 'finnhub',
        url: url('/stock/insider-transactions', { symbol }),
        rateLimit: LIMIT,
      });

      const rows = r?.data ?? [];
      if (rows.length === 0) {
        return unavailable(
          'not_supported',
          'Finnhub returned no insider filings. This endpoint requires a premium plan; an empty result does not mean there was no insider activity.',
        );
      }

      return ok(
        rows.slice(0, 20).map((row) => {
          const tx: InsiderTransaction = {
            name: row.name,
            share: row.share,
            change: row.change,
            filingDate: new Date(`${row.filingDate}T00:00:00Z`),
            transactionDate: new Date(`${row.transactionDate}T00:00:00Z`),
            source: 'finnhub',
          };
          setNumber(tx, 'transactionPrice', row.transactionPrice);
          if (row.transactionCode) tx.transactionCode = row.transactionCode;
          return tx;
        }),
      );
    } catch (e) {
      return classifyError(e);
    }
  },

  async institutionalOwnership(symbol: string): Promise<ProviderResult<InstitutionalHolder[]>> {
    if (!env.providers.finnhub) {
      return unavailable('no_provider_configured', 'FINNHUB_API_KEY is not set');
    }
    try {
      const r = await fetchJson<FinnhubOwnershipResponse>({
        provider: 'finnhub',
        url: url('/stock/institutional-ownership', { symbol, from: '', to: '' }),
        rateLimit: LIMIT,
      });

      const rows = r?.ownership ?? [];
      if (rows.length === 0) {
        return unavailable(
          'not_supported',
          'Finnhub returned no institutional holdings. This endpoint requires a premium plan.',
        );
      }

      return ok(
        rows.slice(0, 20).map((row) => {
          const holder: InstitutionalHolder = {
            name: row.name,
            share: row.share,
            change: row.change,
            filingDate: new Date(`${row.filingDate}T00:00:00Z`),
            source: 'finnhub',
          };
          setNumber(holder, 'portfolioPercent', row.portfolioPercent);
          return holder;
        }),
      );
    } catch (e) {
      return classifyError(e);
    }
  },
};
