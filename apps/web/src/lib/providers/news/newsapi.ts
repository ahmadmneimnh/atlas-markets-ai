import { env } from '@/lib/env';
import { fetchJson } from '@/lib/http';
import type { Provider, ProviderResult, NewsArticle } from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';
import { findAsset } from '@/lib/universe';

/**
 * NewsAPI.org — general news, as a fallback behind the finance-native providers.
 *
 * Deliberately last in the news ordering. Finnhub and FMP return *company* news:
 * articles a financial data vendor has already associated with a ticker. NewsAPI
 * returns keyword search results, and the difference matters more than it sounds
 * — a query for "F" (Ford) matches almost anything, and "MSFT" matches almost
 * nothing because journalists write "Microsoft".
 *
 * Two consequences are handled here rather than pushed downstream into the
 * sentiment classifier, which cannot tell a mismatched article from a bearish one:
 *
 *  1. The query is built from the company *name* where the tracked universe knows
 *     it, falling back to the bare symbol. A ticker is a poor search term.
 *  2. Single-character and two-character symbols are refused outright rather than
 *     searched. There is no query for "F" that returns Ford news reliably, and
 *     scoring an asset on articles about an unrelated subject is worse than
 *     scoring it on no articles at all — the first produces a confident wrong
 *     answer, the second an honest absence.
 *
 * The free tier is 100 requests/day and does not serve articles less than 24
 * hours old. That is why this sits behind the others rather than leading.
 */

const BASE = 'https://newsapi.org/v2';
// 100/day on the free tier. The window here is a burst guard, not the quota —
// the real protection is the news cache TTL in the registry.
const LIMIT = { requests: 10, windowMs: 60_000 };

/** Below this length a ticker is not a usable search term. */
const MIN_SYMBOL_LENGTH = 3;

interface NewsApiArticle {
  title?: string;
  description?: string;
  url?: string;
  publishedAt?: string;
  source?: { id?: string | null; name?: string };
}

interface NewsApiResponse {
  status: string;
  totalResults?: number;
  articles?: NewsApiArticle[];
  /** Present when status is "error". */
  code?: string;
  message?: string;
}

export const newsapi: Provider = {
  id: 'newsapi',
  label: 'NewsAPI.org',
  capabilities: ['news'],
  isConfigured: () => Boolean(env.providers.newsApi),

  async news(symbol: string | null, limit: number): Promise<ProviderResult<NewsArticle[]>> {
    const key = env.providers.newsApi;
    if (!key) return unavailable('no_provider_configured', 'NEWS_API_KEY is not set');

    // A market-wide request is well served by NewsAPI's business headlines; a
    // per-symbol one needs a query good enough to be about that company.
    let endpoint: string;
    if (symbol === null) {
      endpoint = `${BASE}/top-headlines?category=business&language=en&pageSize=${clamp(limit)}`;
    } else {
      if (symbol.length < MIN_SYMBOL_LENGTH && !findAsset(symbol, 'equity')) {
        return unavailable(
          'not_supported',
          `"${symbol}" is too short to search as a keyword and is not in the tracked universe; ` +
            `a NewsAPI query for it would return unrelated articles`,
        );
      }
      const query = queryFor(symbol);
      endpoint =
        `${BASE}/everything?q=${encodeURIComponent(query)}` +
        `&language=en&sortBy=publishedAt&pageSize=${clamp(limit)}`;
    }

    try {
      const response = await fetchJson<NewsApiResponse>({
        provider: 'newsapi',
        url: endpoint,
        // The key goes in a header, never the query string: URLs reach logs,
        // proxies and error reports, and a leaked key is a billing incident.
        headers: { 'X-Api-Key': key },
        rateLimit: LIMIT,
      });

      // NewsAPI answers some failures with HTTP 200 and status:"error", so a
      // successful fetch is not a successful request.
      if (response.status !== 'ok') {
        return unavailable(
          response.code === 'rateLimited' ? 'rate_limited' : 'upstream_error',
          response.message ?? `newsapi returned status "${response.status}"`,
        );
      }

      const articles = response.articles ?? [];
      if (articles.length === 0) {
        return unavailable('not_found', `no articles for ${symbol ?? 'the market'}`);
      }

      const mapped: NewsArticle[] = [];
      for (const article of articles) {
        // A headline or a link that is missing makes the article unusable and
        // unverifiable. Dropped rather than filled with a placeholder.
        if (!article.title || !article.url) continue;
        const publishedAt = article.publishedAt ? new Date(article.publishedAt) : undefined;
        if (!publishedAt || Number.isNaN(publishedAt.getTime())) continue;

        // "[Removed]" is NewsAPI's own marker for a retracted article.
        if (article.title === '[Removed]') continue;

        const entry: NewsArticle = {
          // NewsAPI has no stable article id, so the URL is the identity. It is
          // what dedupes across a refresh.
          id: article.url,
          headline: article.title,
          url: article.url,
          publishedAt,
          outlet: article.source?.name ?? 'unknown',
          source: 'newsapi',
        };
        if (article.description) entry.summary = article.description;
        mapped.push(entry);
      }

      if (mapped.length === 0) {
        return unavailable('not_found', 'every article in the response was missing a title or url');
      }
      return ok(mapped.slice(0, limit));
    } catch (e) {
      return classifyError(e);
    }
  },
};

function clamp(limit: number): number {
  return Math.max(1, Math.min(100, limit));
}

/**
 * The search query for a symbol.
 *
 * Prefers the company name, because that is what articles actually say. The
 * symbol is OR-ed in rather than dropped so ticker-tagged market reports still
 * match.
 */
function queryFor(symbol: string): string {
  const known = findAsset(symbol, 'equity') ?? findAsset(symbol, 'crypto');
  if (!known) return symbol;
  // Quoted so a multi-word name matches as a phrase rather than as loose terms.
  return `"${known.name}" OR ${symbol}`;
}
