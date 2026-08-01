import { env } from '@/lib/env';
import { fetchJson } from '@/lib/http';
import type { Provider, ProviderResult, Filing } from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';

/**
 * SEC EDGAR — statutory company filings.
 *
 * Free, public, and not an API key situation: EDGAR authenticates nothing and
 * rate-limits by declared identity instead. Its access policy requires every
 * request to carry a `User-Agent` naming a real contact, and it returns 403 to
 * requests without one.
 *
 * That is why this adapter reports itself unconfigured when `SEC_USER_AGENT` is
 * unset rather than inventing a plausible-looking header. Sending a fabricated
 * contact address to a government system to obtain data is not a shortcut worth
 * taking on a user's behalf, and a deployment that gets its access withdrawn for
 * doing so has a much worse problem than a missing panel.
 *
 * **Scope: links, not interpretations.** This returns filing metadata and the
 * document URL. It does not parse a 10-K into fields. The structured financials
 * already come from FMP, where a vendor did the extraction and can be cited for
 * it; re-deriving them here from raw prose would produce numbers with no
 * provenance that look exactly like the attributable ones.
 *
 * EDGAR is US-only. Non-US listings resolve to no CIK, which is reported as
 * `not_found` rather than as an error — the absence is a fact about the venue.
 */

const TICKER_MAP_URL = 'https://www.sec.gov/files/company_tickers.json';
const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';

// SEC's published ceiling is 10 requests/second. We sit well under it: the
// ticker map is cached for a day and submissions for hours, so throughput here
// is never the constraint.
const LIMIT = { requests: 5, windowMs: 1_000 };

/** EDGAR's ticker file, keyed by an arbitrary index rather than by symbol. */
interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

interface SubmissionsResponse {
  cik?: string;
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      filingDate?: string[];
      reportDate?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
}

function headers(): Record<string, string> {
  return { 'User-Agent': env.secUserAgent as string };
}

/**
 * Symbol → CIK, from EDGAR's own mapping file.
 *
 * The file is ~10k entries and changes rarely, so it is fetched once and held
 * for the process lifetime behind a promise — concurrent callers during a cold
 * scan share one request instead of each triggering their own download.
 */
let tickerMap: Promise<Map<string, { cik: string; title: string }>> | undefined;

async function loadTickerMap(): Promise<Map<string, { cik: string; title: string }>> {
  const raw = await fetchJson<Record<string, TickerEntry>>({
    provider: 'sec',
    url: TICKER_MAP_URL,
    headers: headers(),
    rateLimit: LIMIT,
    timeoutMs: 15_000,
  });

  const map = new Map<string, { cik: string; title: string }>();
  for (const entry of Object.values(raw)) {
    if (!entry?.ticker || typeof entry.cik_str !== 'number') continue;
    // CIK is zero-padded to ten digits in every EDGAR path.
    map.set(entry.ticker.toUpperCase(), {
      cik: String(entry.cik_str).padStart(10, '0'),
      title: entry.title,
    });
  }
  return map;
}

function tickers(): Promise<Map<string, { cik: string; title: string }>> {
  if (!tickerMap) {
    tickerMap = loadTickerMap().catch((err: unknown) => {
      // A failed load must not be cached forever, or one transient 503 disables
      // filings for the life of the process.
      tickerMap = undefined;
      throw err;
    });
  }
  return tickerMap;
}

export const sec: Provider = {
  id: 'sec',
  label: 'SEC EDGAR',
  capabilities: ['filings'],
  isConfigured: () => Boolean(env.secUserAgent),

  async filings(symbol: string, limit: number): Promise<ProviderResult<Filing[]>> {
    if (!env.secUserAgent) {
      return unavailable(
        'no_provider_configured',
        'SEC_USER_AGENT is not set. EDGAR requires a declared contact ("Company Name admin@example.com") and returns 403 without one.',
      );
    }

    try {
      const map = await tickers();
      const match = map.get(symbol.toUpperCase());
      if (!match) {
        return unavailable(
          'not_found',
          `${symbol} has no CIK in EDGAR — it is not a US-registered filer`,
        );
      }

      const submissions = await fetchJson<SubmissionsResponse>({
        provider: 'sec',
        url: `${SUBMISSIONS_BASE}/CIK${match.cik}.json`,
        headers: headers(),
        rateLimit: LIMIT,
        timeoutMs: 15_000,
      });

      const recent = submissions.filings?.recent;
      if (!recent?.accessionNumber || !recent.form || !recent.filingDate) {
        return unavailable('not_found', `EDGAR returned no recent filings for ${symbol}`);
      }

      // EDGAR returns parallel arrays rather than an array of objects, so the
      // index is the only thing tying a form to its date. A short array on any
      // one of them means the rows past that point cannot be assembled without
      // guessing which form a date belongs to — so iteration stops at the
      // shortest, rather than reading undefined into a field.
      const rows = Math.min(
        recent.accessionNumber.length,
        recent.form.length,
        recent.filingDate.length,
      );

      const filer = submissions.name ?? match.title;
      const out: Filing[] = [];

      for (let i = 0; i < rows && out.length < limit; i++) {
        const accession = recent.accessionNumber[i];
        const form = recent.form[i];
        const filedRaw = recent.filingDate[i];
        if (!accession || !form || !filedRaw) continue;

        const filedAt = new Date(`${filedRaw}T00:00:00Z`);
        if (Number.isNaN(filedAt.getTime())) continue;

        const bare = accession.replace(/-/g, '');
        const document = recent.primaryDocument?.[i];
        const entry: Filing = {
          id: accession,
          form,
          filedAt,
          // Link to the document when EDGAR names one, else to the submission
          // index, which always exists.
          url: document
            ? `${ARCHIVES_BASE}/${Number(match.cik)}/${bare}/${document}`
            : `${ARCHIVES_BASE}/${Number(match.cik)}/${bare}/${accession}-index.htm`,
          filer,
          source: 'sec',
        };

        const period = recent.reportDate?.[i];
        if (period) {
          const parsed = new Date(`${period}T00:00:00Z`);
          if (!Number.isNaN(parsed.getTime())) entry.periodOfReport = parsed;
        }

        const description = recent.primaryDocDescription?.[i];
        if (description) entry.description = description;

        out.push(entry);
      }

      if (out.length === 0) {
        return unavailable('not_found', `no parseable filings for ${symbol}`);
      }
      return ok(out);
    } catch (e) {
      return classifyError(e);
    }
  },
};
