import { UNIVERSE, type UniverseEntry } from '@/lib/universe';

/**
 * Instant search over the tracked universe.
 *
 * Runs in-process against a static list — no network, no provider quota, no
 * latency. That matters more than it sounds: autocomplete fires on every
 * keystroke, and routing each one to a vendor would burn a free tier in a single
 * enthusiastic search and still feel slow. Provider search is layered *behind*
 * this for symbols outside the tracked list.
 *
 * Ranking is explicit rather than a similarity score, because the ordering users
 * actually expect is lexicographic by match quality, not by edit distance:
 * someone typing "APP" wants AAPL before Applied Materials, and someone typing
 * "BIT" wants Bitcoin. A generic fuzzy library gets both of those wrong often
 * enough to be annoying.
 */

export interface LocalHit extends UniverseEntry {
  /** Higher is better. Exposed so the API can merge and re-sort across sources. */
  score: number;
  /** Which field matched, for the UI to highlight. */
  matched: 'symbol' | 'name';
}

/** Ranked highest to lowest. The gaps are wide so provider hits can slot between. */
const RANK = {
  exactSymbol: 1000,
  symbolPrefix: 800,
  exactName: 700,
  namePrefix: 600,
  nameWordPrefix: 500,
  symbolContains: 300,
} as const;

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Scores one entry against a query, or returns null when it does not match.
 *
 * Deliberately returns null rather than 0 for a non-match: 0 is a legitimate
 * score for a weak match, and conflating the two is how unrelated results end up
 * in a dropdown.
 */
function scoreEntry(entry: UniverseEntry, query: string): LocalHit | null {
  const symbol = normalise(entry.symbol);
  const name = normalise(entry.name);

  if (symbol === query) return { ...entry, score: RANK.exactSymbol, matched: 'symbol' };
  if (name === query) return { ...entry, score: RANK.exactName, matched: 'name' };
  if (symbol.startsWith(query)) return { ...entry, score: RANK.symbolPrefix, matched: 'symbol' };
  if (name.startsWith(query)) return { ...entry, score: RANK.namePrefix, matched: 'name' };

  // A word-boundary match inside the name: "motor" should find Toyota Motor
  // Corp., but "otor" should not — an interior fragment is almost always a
  // coincidence rather than what the user meant.
  const words = name.split(/[\s.,&-]+/);
  if (words.some((word) => word.startsWith(query))) {
    return { ...entry, score: RANK.nameWordPrefix, matched: 'name' };
  }

  // Tickers are short enough that an interior substring is usually intentional —
  // "OOG" for GOOGL is a real way people search.
  if (symbol.includes(query)) return { ...entry, score: RANK.symbolContains, matched: 'symbol' };

  // There is deliberately no interior-substring tier for names. It would match
  // "otor" against "Toyota Motor", and a dropdown full of coincidences is worse
  // than a short one: the word-prefix tier above already covers every case where
  // the user meant a word in the name.
  return null;
}

export interface LocalSearchOptions {
  limit?: number;
  /** Restrict to one asset class. Omitted searches both. */
  kind?: 'equity' | 'crypto';
}

export function searchUniverse(rawQuery: string, options: LocalSearchOptions = {}): LocalHit[] {
  const query = normalise(rawQuery);
  if (query.length === 0) return [];

  const { limit = 8, kind } = options;

  const hits: LocalHit[] = [];
  for (const entry of UNIVERSE) {
    if (kind && entry.kind !== kind) continue;
    const hit = scoreEntry(entry, query);
    if (hit) hits.push(hit);
  }

  return hits
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable, predictable tie-break. Without it, two entries with the same
      // rank reorder between renders and the dropdown flickers under the cursor.
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, limit);
}

/**
 * The single best match, used to resolve a bare Enter press into a destination.
 *
 * Returns undefined unless the match is strong — a prefix or exact hit. Sending
 * someone to a page because their query happened to appear in the middle of a
 * company name is worse than showing them a search results page, since the
 * detail page they land on looks authoritative and is simply wrong.
 */
export function resolveBestMatch(rawQuery: string): UniverseEntry | undefined {
  const [best] = searchUniverse(rawQuery, { limit: 1 });
  if (!best) return undefined;
  return best.score >= RANK.namePrefix ? best : undefined;
}
