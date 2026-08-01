import { env } from '@/lib/env';
import { fetchJson } from '@/lib/http';
import type {
  AnalystEstimates,
  CompanyProfile,
  Fundamentals,
  NewsArticle,
  Provider,
  ProviderResult,
  Quote,
} from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';
import { setNumber } from '../util';

/**
 * Financial Modeling Prep — the strongest fundamentals source here, and the only
 * one exposing full statements (income, balance sheet, cash flow) plus analyst
 * ratings and price targets.
 *
 * Free tier is 250 requests/day, so the rate limiter is set low deliberately: a
 * screener that fans out across the universe would otherwise exhaust a day's
 * quota in one page load.
 */
const BASE = 'https://financialmodelingprep.com/api/v3';
const LIMIT = { requests: 10, windowMs: 60_000 };

interface FmpQuote {
  symbol: string;
  price?: number;
  change?: number;
  changesPercentage?: number;
  dayLow?: number;
  dayHigh?: number;
  open?: number;
  previousClose?: number;
  volume?: number;
  marketCap?: number;
  timestamp?: number;
}

interface FmpProfile {
  symbol: string;
  companyName?: string;
  exchangeShortName?: string;
  country?: string;
  sector?: string;
  industry?: string;
  website?: string;
  image?: string;
  description?: string;
  fullTimeEmployees?: string;
  currency?: string;
}

interface FmpKeyMetrics {
  peRatio?: number;
  pegRatio?: number;
  roe?: number;
  roic?: number;
  debtToEquity?: number;
  dividendYield?: number;
  freeCashFlowPerShare?: number;
  marketCap?: number;
}

interface FmpRatios {
  priceEarningsRatio?: number;
  priceEarningsToGrowthRatio?: number;
  returnOnEquity?: number;
  debtEquityRatio?: number;
  netProfitMargin?: number;
  dividendYield?: number;
}

interface FmpGrowth {
  revenueGrowth?: number;
  epsgrowth?: number;
}

export interface FmpIncomeStatement {
  date: string;
  period: string;
  reportedCurrency?: string;
  revenue?: number;
  costOfRevenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  eps?: number;
  epsdiluted?: number;
  ebitda?: number;
}

export interface FmpBalanceSheet {
  date: string;
  period: string;
  totalAssets?: number;
  totalLiabilities?: number;
  totalEquity?: number;
  cashAndCashEquivalents?: number;
  totalDebt?: number;
  netDebt?: number;
}

export interface FmpCashFlow {
  date: string;
  period: string;
  operatingCashFlow?: number;
  capitalExpenditure?: number;
  freeCashFlow?: number;
  dividendsPaid?: number;
  netChangeInCash?: number;
}

interface FmpNews {
  symbol?: string;
  publishedDate: string;
  title: string;
  image?: string;
  site: string;
  text?: string;
  url: string;
}

export interface FmpAnalystRating {
  symbol: string;
  date: string;
  analystRatingsbuy?: number;
  analystRatingsHold?: number;
  analystRatingsSell?: number;
  analystRatingsStrongSell?: number;
  analystRatingsStrongBuy?: number;
}

export interface FmpPriceTarget {
  symbol: string;
  targetHigh?: number;
  targetLow?: number;
  targetConsensus?: number;
  targetMedian?: number;
}

function url(path: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ ...params, apikey: env.providers.fmp ?? '' });
  return `${BASE}${path}?${q}`;
}

/**
 * FMP answers an exhausted quota with HTTP 200 and `{"Error Message": "..."}`,
 * and an unknown symbol with `[]`. Both look like success to a naive caller.
 */
function errorEnvelope(body: unknown) {
  if (body && typeof body === 'object' && 'Error Message' in body) {
    const message = String((body as Record<string, unknown>)['Error Message']);
    return /limit|quota/i.test(message)
      ? unavailable('rate_limited', message)
      : unavailable('upstream_error', message);
  }
  return null;
}

export const fmp: Provider = {
  id: 'fmp',
  label: 'Financial Modeling Prep',
  capabilities: ['quote', 'profile', 'fundamentals', 'news', 'analyst'],

  isConfigured: () => Boolean(env.providers.fmp),

  async quote(symbol: string): Promise<ProviderResult<Quote>> {
    try {
      const r = await fetchJson<FmpQuote[]>({
        provider: 'fmp',
        url: url(`/quote/${encodeURIComponent(symbol)}`),
        rateLimit: LIMIT,
      });

      const envelope = errorEnvelope(r);
      if (envelope) return envelope;

      const q = Array.isArray(r) ? r[0] : undefined;
      if (!q || typeof q.price !== 'number') {
        return unavailable('not_found', `no quote for ${symbol}`);
      }

      const quote: Quote = {
        symbol,
        price: q.price,
        change: q.change ?? 0,
        changePercent: q.changesPercentage ?? 0,
        source: 'fmp',
        asOf: q.timestamp ? new Date(q.timestamp * 1000) : new Date(),
      };
      setNumber(quote, 'open', q.open);
      setNumber(quote, 'high', q.dayHigh);
      setNumber(quote, 'low', q.dayLow);
      setNumber(quote, 'previousClose', q.previousClose);
      setNumber(quote, 'volume', q.volume);
      return ok(quote);
    } catch (error) {
      return classifyError(error);
    }
  },

  async profile(symbol: string): Promise<ProviderResult<CompanyProfile>> {
    try {
      const r = await fetchJson<FmpProfile[]>({
        provider: 'fmp',
        url: url(`/profile/${encodeURIComponent(symbol)}`),
        rateLimit: LIMIT,
      });

      const envelope = errorEnvelope(r);
      if (envelope) return envelope;

      const p = Array.isArray(r) ? r[0] : undefined;
      if (!p?.companyName) return unavailable('not_found', `no profile for ${symbol}`);

      const profile: CompanyProfile = {
        symbol,
        name: p.companyName,
        source: 'fmp',
        asOf: new Date(),
      };
      if (p.exchangeShortName) profile.exchange = p.exchangeShortName;
      if (p.country) profile.country = p.country;
      if (p.sector) profile.sector = p.sector;
      if (p.industry) profile.industry = p.industry;
      if (p.website) profile.website = p.website;
      if (p.image) profile.logo = p.image;
      if (p.description) profile.description = p.description;
      return ok(profile);
    } catch (error) {
      return classifyError(error);
    }
  },

  async fundamentals(symbol: string): Promise<ProviderResult<Fundamentals>> {
    try {
      // Three endpoints in parallel. `allSettled`, not `all`: FMP gates some
      // endpoints by plan, so one 403 must not discard the two that succeeded —
      // partial fundamentals are worth far more than none, and the engine already
      // renormalizes around whatever is missing.
      const [metricsResult, ratiosResult, growthResult] = await Promise.allSettled([
        fetchJson<FmpKeyMetrics[]>({
          provider: 'fmp',
          url: url(`/key-metrics-ttm/${encodeURIComponent(symbol)}`),
          rateLimit: LIMIT,
        }),
        fetchJson<FmpRatios[]>({
          provider: 'fmp',
          url: url(`/ratios-ttm/${encodeURIComponent(symbol)}`),
          rateLimit: LIMIT,
        }),
        fetchJson<FmpGrowth[]>({
          provider: 'fmp',
          url: url(`/financial-growth/${encodeURIComponent(symbol)}`, { limit: '1' }),
          rateLimit: LIMIT,
        }),
      ]);

      const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value?.[0] : undefined;
      const ratios = ratiosResult.status === 'fulfilled' ? ratiosResult.value?.[0] : undefined;
      const growth = growthResult.status === 'fulfilled' ? growthResult.value?.[0] : undefined;

      if (!metrics && !ratios && !growth) {
        return unavailable('not_found', `no fundamentals for ${symbol}`);
      }

      const fundamentals: Fundamentals = { symbol, source: 'fmp', asOf: new Date() };
      setNumber(fundamentals, 'peRatio', metrics?.peRatio ?? ratios?.priceEarningsRatio);
      setNumber(fundamentals, 'pegRatio', metrics?.pegRatio ?? ratios?.priceEarningsToGrowthRatio);
      setNumber(fundamentals, 'roe', metrics?.roe ?? ratios?.returnOnEquity);
      setNumber(fundamentals, 'roic', metrics?.roic);
      setNumber(fundamentals, 'debtToEquity', metrics?.debtToEquity ?? ratios?.debtEquityRatio);
      setNumber(fundamentals, 'profitMargin', ratios?.netProfitMargin);
      setNumber(fundamentals, 'dividendYield', metrics?.dividendYield ?? ratios?.dividendYield);
      setNumber(fundamentals, 'marketCap', metrics?.marketCap);
      setNumber(fundamentals, 'revenueGrowthYoY', growth?.revenueGrowth);
      setNumber(fundamentals, 'earningsGrowthYoY', growth?.epsgrowth);
      return ok(fundamentals);
    } catch (error) {
      return classifyError(error);
    }
  },

  async news(symbol: string | null, limit: number): Promise<ProviderResult<NewsArticle[]>> {
    try {
      const params: Record<string, string> = { limit: String(Math.min(limit, 50)) };
      if (symbol) params.tickers = symbol;

      const r = await fetchJson<FmpNews[]>({
        provider: 'fmp',
        url: url('/stock_news', params),
        rateLimit: LIMIT,
      });

      const envelope = errorEnvelope(r);
      if (envelope) return envelope;
      if (!Array.isArray(r) || r.length === 0) {
        return unavailable('not_found', 'no articles');
      }

      return ok(
        r.slice(0, limit).map((a) => ({
          id: a.url,
          headline: a.title,
          ...(a.text ? { summary: a.text.slice(0, 400) } : {}),
          url: a.url,
          publishedAt: new Date(a.publishedDate.replace(' ', 'T') + 'Z'),
          outlet: a.site,
          source: 'fmp',
        })),
      );
    } catch (error) {
      return classifyError(error);
    }
  },

  /**
   * Price targets and the rating distribution, as one value.
   *
   * The two live at different FMP endpoints and are fetched concurrently. A
   * failure on either side is tolerated as long as the other returns something,
   * because "targets but no ratings" is a genuinely useful partial answer — but
   * if both fail the result is unavailable rather than an empty object, which
   * would read downstream as "analysts have no view" instead of "we did not get
   * one".
   */
  async analystEstimates(symbol: string): Promise<ProviderResult<AnalystEstimates>> {
    if (!env.providers.fmp) {
      return unavailable('no_provider_configured', 'FMP_API_KEY is not set');
    }

    const [targets, ratings] = await Promise.all([
      fmpExtras.priceTarget(symbol),
      fmpExtras.analystRatings(symbol),
    ]);

    if (!targets.ok && !ratings.ok) {
      return targets.reason === 'not_found' ? targets : ratings;
    }

    const estimates: AnalystEstimates = { symbol, source: 'fmp', asOf: new Date() };

    if (targets.ok) {
      setNumber(estimates, 'targetConsensus', targets.data.targetConsensus);
      setNumber(estimates, 'targetHigh', targets.data.targetHigh);
      setNumber(estimates, 'targetLow', targets.data.targetLow);
    }

    if (ratings.ok) {
      // The endpoint returns a history, most recent first. Only the latest row
      // is a current view; averaging six months of distributions would blur a
      // recent downgrade into the consensus that preceded it.
      const latest = ratings.data[0];
      if (latest) {
        setNumber(estimates, 'strongBuy', latest.analystRatingsStrongBuy);
        setNumber(estimates, 'buy', latest.analystRatingsbuy);
        setNumber(estimates, 'hold', latest.analystRatingsHold);
        setNumber(estimates, 'sell', latest.analystRatingsSell);
        setNumber(estimates, 'strongSell', latest.analystRatingsStrongSell);
        const asOf = new Date(latest.date);
        if (!Number.isNaN(asOf.getTime())) estimates.asOf = asOf;
      }
    }

    return ok(estimates);
  },
};

/**
 * Financial statements, analyst ratings and price targets.
 *
 * These are not `Capability` methods because only FMP among the configured
 * vendors serves them, and inventing a capability with exactly one possible
 * provider would give the registry nothing to route between — a fallthrough list
 * of length one is a function call wearing a costume. The detail page calls these
 * directly and renders "unavailable" when FMP is not configured.
 */
export const fmpExtras = {
  isConfigured: () => Boolean(env.providers.fmp),

  async incomeStatement(
    symbol: string,
    periods = 5,
  ): Promise<ProviderResult<FmpIncomeStatement[]>> {
    return fetchList<FmpIncomeStatement>(
      `/income-statement/${encodeURIComponent(symbol)}`,
      periods,
    );
  },

  async balanceSheet(symbol: string, periods = 5): Promise<ProviderResult<FmpBalanceSheet[]>> {
    return fetchList<FmpBalanceSheet>(
      `/balance-sheet-statement/${encodeURIComponent(symbol)}`,
      periods,
    );
  },

  async cashFlow(symbol: string, periods = 5): Promise<ProviderResult<FmpCashFlow[]>> {
    return fetchList<FmpCashFlow>(`/cash-flow-statement/${encodeURIComponent(symbol)}`, periods);
  },

  async priceTarget(symbol: string): Promise<ProviderResult<FmpPriceTarget>> {
    const result = await fetchList<FmpPriceTarget>(
      `/price-target-consensus?symbol=${encodeURIComponent(symbol)}`,
      1,
    );
    if (!result.ok) return result;
    const first = result.data[0];
    return first ? ok(first) : unavailable('not_found', `no price target for ${symbol}`);
  },

  async analystRatings(symbol: string): Promise<ProviderResult<FmpAnalystRating[]>> {
    return fetchList<FmpAnalystRating>(
      `/analyst-stock-recommendations/${encodeURIComponent(symbol)}`,
      6,
    );
  },
};

async function fetchList<T>(path: string, limit: number): Promise<ProviderResult<T[]>> {
  if (!env.providers.fmp) {
    return unavailable('no_provider_configured', 'FMP_API_KEY is not set');
  }
  try {
    const separator = path.includes('?') ? '&' : '?';
    const r = await fetchJson<T[]>({
      provider: 'fmp',
      url: `${BASE}${path}${separator}limit=${limit}&apikey=${env.providers.fmp}`,
      rateLimit: LIMIT,
    });

    const envelope = errorEnvelope(r);
    if (envelope) return envelope;
    if (!Array.isArray(r) || r.length === 0) return unavailable('not_found', 'no rows');
    return ok(r);
  } catch (error) {
    return classifyError(error);
  }
}
