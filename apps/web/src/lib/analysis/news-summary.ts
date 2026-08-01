import type { NewsArticle } from '@/lib/providers/types';
import type { ScoreBreakdown } from './types';

/**
 * The market summary that replaces a long news feed.
 *
 * "AI-generated summary" is the requirement; the honest implementation is a
 * summary **derived from what the news factor already measured**, not prose
 * written about the headlines. The distinction matters more here than anywhere
 * else in the product:
 *
 * A language model handed ten headlines will produce a fluent paragraph about
 * the company's prospects. It will be readable, plausible, and unattributable —
 * and a reader cannot tell which part came from a headline and which part the
 * model supplied. That is fabrication with good grammar.
 *
 * What this does instead: report the classifier's actual output — how many
 * articles it read, how they split by direction, its own confidence in that
 * reading — and then link every source. Every number in the summary traces to a
 * document, and the wording changes only with the measurements.
 */

export interface NewsSummary {
  /** One or two sentences, assembled from measured values only. */
  headline: string;
  /** Supporting statements, each backed by a count or a cited signal. */
  points: string[];
  /** The articles behind it, for the reader to check. */
  sources: { title: string; url: string; outlet: string; publishedAt: Date }[];
  /** 0-1, the news factor's own confidence. Absent when the factor did not run. */
  confidence?: number;
  /** Stated when the classifier's confidence is capped by its own limitations. */
  caveat?: string;
}

/** The lexicon classifier caps itself here; above this a stronger claim is fair. */
const CAPPED_CONFIDENCE = 0.6;

function countDirections(factor: ScoreBreakdown): {
  bullish: number;
  bearish: number;
  neutral: number;
} {
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  for (const signal of factor.signals) {
    if (signal.direction === 'bullish') bullish += 1;
    else if (signal.direction === 'bearish') bearish += 1;
    else neutral += 1;
  }
  return { bullish, bearish, neutral };
}

export function buildNewsSummary(
  breakdown: ScoreBreakdown[],
  articles: NewsArticle[],
  omitted: { factor: string; reason: string }[],
): NewsSummary {
  const sources = articles.slice(0, 8).map((article) => ({
    title: article.headline,
    url: article.url,
    outlet: article.outlet,
    publishedAt: article.publishedAt,
  }));

  const newsFactor = breakdown.find((factor) => factor.factor === 'news');

  if (!newsFactor) {
    const reason = omitted.find((entry) => entry.factor === 'news')?.reason;
    return {
      headline: 'No news sentiment was measured for this asset.',
      points: [
        reason ??
          'The news factor did not run, so nothing here is a claim about coverage — only about our lack of it.',
      ],
      sources,
    };
  }

  const { bullish, bearish, neutral } = countDirections(newsFactor);
  const total = bullish + bearish + neutral;

  if (total === 0) {
    return {
      headline: 'The news factor ran but classified no individual headlines.',
      points: ['No directional signal was produced, so news contributed nothing to the score.'],
      sources,
      confidence: newsFactor.confidence,
    };
  }

  // The lead sentence states the measured split, in the classifier's own terms.
  // No adjective appears that is not licensed by the counts.
  const lean =
    bullish > bearish ? 'leans positive' : bearish > bullish ? 'leans negative' : 'is balanced';

  const summary: NewsSummary = {
    headline: `Coverage ${lean}: ${bullish} positive, ${bearish} negative and ${neutral} neutral of ${total} classified ${total === 1 ? 'signal' : 'signals'}.`,
    points: [],
    sources,
    confidence: newsFactor.confidence,
  };

  summary.points.push(
    `The news factor scored ${newsFactor.score.toFixed(0)}/100 and carried ${newsFactor.effectiveWeight.toFixed(0)}% of the final weight.`,
  );

  // The strongest individual classifications, quoted rather than paraphrased.
  const ranked = [...newsFactor.signals]
    .filter((signal) => signal.direction !== 'neutral')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  for (const signal of ranked) {
    summary.points.push(
      `${signal.label}: ${signal.value} — ${signal.direction} (${signal.source})`,
    );
  }

  if (newsFactor.confidence <= CAPPED_CONFIDENCE) {
    summary.caveat =
      'Headlines are classified by a finance lexicon, not a language model. It reads negation and recency but not sarcasm or context, so its confidence is capped — treat the direction as a hint, not a conclusion.';
  }

  if (sources.length === 0) {
    summary.points.push(
      'No article links are available from the configured providers, so this reading cannot be checked against its sources.',
    );
  }

  return summary;
}
