import type { NewsArticle } from '@/lib/providers/types';
import { formatNumber } from '@/lib/format';
import { clamp } from './technical';
import {
  moduleUnavailable, reason, warning,
  type Evidence, type Metric, type ModuleResult,
} from './types';

/**
 * News sentiment.
 *
 * The method is a transparent, finance-specific lexicon over real headlines — not a
 * language model, and not a guess. That choice is deliberate: every score here can
 * be traced to the words that produced it and the articles they came from, and the
 * module reports how many articles it actually read.
 *
 * When no news provider covers the asset the module is unavailable with a reason.
 * It never falls back to "neutral", because a neutral score is a claim about the
 * news, and claiming anything about news you have not read is fabrication.
 */

/** Term → weight in [-1, 1]. Phrases are matched as whole words, case-insensitively. */
export const LEXICON: Record<string, number> = {
  // Strongly positive
  'beats expectations': 0.9, 'record high': 0.8, 'raises guidance': 0.9, 'upgrade': 0.7,
  'upgraded': 0.7, 'outperform': 0.6, 'buyback': 0.6, 'surge': 0.6, 'surges': 0.6,
  'soars': 0.8, 'rally': 0.5, 'rallies': 0.5, 'breakthrough': 0.6, 'partnership': 0.4,
  'approval': 0.6, 'approved': 0.5, 'expansion': 0.4, 'profit': 0.4, 'profits': 0.4,
  'strong demand': 0.7, 'beat': 0.5, 'growth': 0.4, 'wins': 0.5, 'landmark': 0.5,
  'adoption': 0.5, 'inflow': 0.5, 'inflows': 0.5, 'accumulation': 0.4, 'bullish': 0.6,
  'all-time high': 0.8, 'dividend increase': 0.6, 'acquisition': 0.3, 'milestone': 0.4,

  // Strongly negative
  'misses expectations': -0.9, 'cuts guidance': -0.9, 'downgrade': -0.7, 'downgraded': -0.7,
  'underperform': -0.6, 'plunge': -0.8, 'plunges': -0.8, 'slump': -0.6, 'slumps': -0.6,
  'lawsuit': -0.6, 'sued': -0.6, 'investigation': -0.7, 'probe': -0.6, 'fraud': -0.9,
  'recall': -0.6, 'layoffs': -0.5, 'bankruptcy': -1, 'default': -0.8, 'delisting': -0.9,
  'hack': -0.9, 'hacked': -0.9, 'exploit': -0.8, 'breach': -0.7, 'ban': -0.7, 'banned': -0.7,
  'fine': -0.5, 'fined': -0.5, 'sec charges': -0.9, 'halt': -0.6, 'halted': -0.6,
  'outflow': -0.5, 'outflows': -0.5, 'selloff': -0.6, 'sell-off': -0.6, 'bearish': -0.6,
  'warning': -0.5, 'warns': -0.5, 'delay': -0.4, 'delayed': -0.4, 'miss': -0.5,
  'loss': -0.5, 'losses': -0.5, 'decline': -0.4, 'declines': -0.4, 'weak demand': -0.7,
  'resign': -0.4, 'resigns': -0.5, 'scandal': -0.8, 'crash': -0.8, 'liquidation': -0.7,
};

const HALF_LIFE_DAYS = 5;

export interface ArticleScore {
  article: NewsArticle;
  /** Raw lexicon score for this article, in [-1, 1]. */
  score: number;
  /** Recency multiplier applied when aggregating. */
  weight: number;
  /** The lexicon terms that matched, for display. */
  terms: string[];
}

/** Scores one article's headline and summary against the lexicon. */
export function scoreArticle(article: NewsArticle, now = Date.now()): ArticleScore {
  const text = `${article.headline} ${article.summary ?? ''}`.toLowerCase();

  let total = 0;
  let matches = 0;
  const terms: string[] = [];

  for (const [term, weight] of Object.entries(LEXICON)) {
    // Word-boundary match so "banned" does not fire on "abandoned" and "miss" does
    // not fire on "mission".
    const pattern = new RegExp(`(^|[^a-z])${escapeRegex(term)}([^a-z]|$)`, 'i');
    if (pattern.test(text)) {
      total += weight;
      matches++;
      terms.push(term);
    }
  }

  const ageDays = Math.max(0, (now - article.publishedAt.getTime()) / (24 * 60 * 60 * 1000));
  return {
    article,
    // Average rather than sum: a long article that repeats a theme should not
    // outweigh three separate stories.
    score: matches === 0 ? 0 : clamp(total / matches, -1, 1),
    weight: 0.5 ** (ageDays / HALF_LIFE_DAYS),
    terms,
  };
}

export function analyseSentiment(
  articles: NewsArticle[] | null,
  unavailable?: { reason: Parameters<typeof moduleUnavailable>[2]; detail?: string },
  now = Date.now(),
): ModuleResult {
  const label = 'News sentiment';

  if (!articles) {
    return moduleUnavailable(
      'sentiment',
      label,
      unavailable?.reason ?? 'no_provider_configured',
      unavailable?.detail ?? 'no news provider is configured for this asset',
    );
  }
  if (articles.length === 0) {
    return moduleUnavailable('sentiment', label, 'not_found', 'the news provider returned no articles for this asset');
  }

  const scored = articles.map((a) => scoreArticle(a, now));
  const scoredWithTerms = scored.filter((s) => s.terms.length > 0);

  const totalWeight = scoredWithTerms.reduce((sum, s) => sum + s.weight, 0);
  const mean =
    totalWeight === 0 ? 0 : scoredWithTerms.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight;

  const positive = scoredWithTerms.filter((s) => s.score > 0.1).length;
  const negative = scoredWithTerms.filter((s) => s.score < -0.1).length;

  const evidence: Evidence[] = [];

  if (scoredWithTerms.length === 0) {
    evidence.push(
      reason(
        'sentiment',
        `${articles.length} recent headlines carried no term in the sentiment lexicon — coverage is neutral, not absent`,
        'neutral',
        'low',
      ),
    );
  } else {
    const strongest = [...scoredWithTerms].sort((a, b) => Math.abs(b.score * b.weight) - Math.abs(a.score * a.weight));
    for (const s of strongest.slice(0, 3)) {
      const when = s.article.publishedAt.toISOString().slice(0, 10);
      const text = `"${truncate(s.article.headline, 110)}" — ${s.article.outlet}, ${when}`;
      if (s.score > 0.1) evidence.push(reason('sentiment', text, 'bullish', 'medium'));
      else if (s.score < -0.1) evidence.push(warning('sentiment', text, 'medium'));
    }

    const balance = `${positive} positive, ${negative} negative out of ${articles.length} headlines in the last two weeks`;
    if (mean > 0.15) evidence.push(reason('sentiment', `News flow is net positive — ${balance}`, 'bullish', 'medium'));
    else if (mean < -0.15) evidence.push(warning('sentiment', `News flow is net negative — ${balance}`, 'medium'));
    else evidence.push(reason('sentiment', `News flow is mixed — ${balance}`, 'neutral', 'low'));
  }

  const metrics: Metric[] = [
    { label: 'Articles read', value: String(articles.length), hint: 'Company news from the last 14 days' },
    { label: 'With sentiment terms', value: String(scoredWithTerms.length) },
    { label: 'Positive / negative', value: `${positive} / ${negative}` },
    {
      label: 'Weighted score',
      value: formatNumber(mean, 2),
      hint: 'Lexicon average, weighted by recency (5-day half-life)',
      direction: mean > 0.15 ? 'bullish' : mean < -0.15 ? 'bearish' : 'neutral',
    },
  ];

  return {
    id: 'sentiment',
    label,
    available: true,
    score: clamp(50 + mean * 50, 0, 100),
    // Confidence in a sentiment read scales with how much of the coverage actually
    // said anything, and with having more than a handful of articles.
    completeness: clamp(
      (scoredWithTerms.length / Math.max(1, articles.length)) * clamp(articles.length / 10, 0.3, 1),
      0.1,
      1,
    ),
    evidence,
    metrics,
    sources: [articles[0]?.source ?? 'news'],
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
