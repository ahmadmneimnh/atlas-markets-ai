import { fetchJson } from '@/lib/http';
import type { FearGreed, Provider, ProviderResult } from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';

/**
 * Alternative.me Crypto Fear & Greed Index. Free, no key, no registration.
 *
 * The index it publishes covers **crypto only**. There is a separate,
 * differently-constructed equity Fear & Greed index (CNN's), and the two are not
 * interchangeable — they weight different inputs and disagree routinely. This
 * adapter therefore stamps `market: 'crypto'` on every reading, and the UI labels
 * it as such rather than presenting it as "the" market sentiment gauge. Showing a
 * crypto index next to equity holdings without saying which it is would be a
 * fabrication of scope, if not of value.
 *
 * `classification` is passed through from the vendor rather than re-derived from
 * the number: re-deriving it means silently disagreeing with their published
 * bands the first time they adjust one.
 */
const BASE = 'https://api.alternative.me/fng/';
const LIMIT = { requests: 30, windowMs: 60_000 };

interface FngEntry {
  value: string;
  value_classification: string;
  timestamp: string;
  time_until_update?: string;
}

interface FngResponse {
  name?: string;
  data?: FngEntry[];
  metadata?: { error?: string | null };
}

function parseEntry(entry: FngEntry | undefined): { value: number; asOf: Date } | undefined {
  if (!entry) return undefined;
  const value = Number(entry.value);
  const seconds = Number(entry.timestamp);
  if (!Number.isFinite(value)) return undefined;
  return {
    value,
    asOf: Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date(),
  };
}

export const alternativeme: Provider = {
  id: 'alternativeme',
  label: 'Alternative.me',
  capabilities: ['fear.greed'],

  isConfigured: () => true,

  async fearGreed(): Promise<ProviderResult<FearGreed>> {
    try {
      // Eight days: today, yesterday, and the reading a week back. The deltas are
      // what make the number readable — 40 on its own says little, 40 down from 72
      // says a great deal.
      const r = await fetchJson<FngResponse>({
        provider: 'alternativeme',
        url: `${BASE}?limit=8`,
        rateLimit: LIMIT,
      });

      if (r.metadata?.error) return unavailable('upstream_error', r.metadata.error);

      const latest = parseEntry(r.data?.[0]);
      if (!latest) return unavailable('not_found', 'no fear & greed reading returned');

      const reading: FearGreed = {
        value: latest.value,
        classification: r.data?.[0]?.value_classification ?? 'Unknown',
        market: 'crypto',
        asOf: latest.asOf,
        source: 'alternativeme',
      };

      const yesterday = parseEntry(r.data?.[1]);
      const weekAgo = parseEntry(r.data?.[7]);
      if (yesterday) reading.previousClose = yesterday.value;
      if (weekAgo) reading.weekAgo = weekAgo.value;

      return ok(reading);
    } catch (error) {
      return classifyError(error);
    }
  },
};
