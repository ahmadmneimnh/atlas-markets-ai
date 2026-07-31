import type { AssetContext, FactorOutcome, FactorScorer, Signal, Direction } from '../types';

/**
 * News sentiment factor (nominal weight 15%).
 *
 * Classification here is a deterministic finance-tuned lexicon, not a language
 * model. That is a deliberate stage-one choice: it is transparent (every
 * classification traces to specific matched terms), free, and has no inference
 * latency. It is also plainly weaker than a transformer on negation, sarcasm and
 * context — "profit warning" and "warns profits will beat" are not separable by
 * term matching alone.
 *
 * The seam for the upgrade is this module's boundary: `classify()` is the only
 * function that inspects text, so swapping in the Python sentiment microservice
 * means replacing one function, not rewriting the factor. Until then, confidence
 * is capped (see CLASSIFIER_CEILING) so a lexicon read never presents itself with
 * the authority of a real model.
 */

const CLASSIFIER_CEILING = 0.6;

/** Weighted terms. Magnitude reflects how strongly the term moves a finance headline. */
const POSITIVE: Record<string, number> = {
  beat: 2, beats: 2, surge: 2, surged: 2, soar: 2.5, soars: 2.5, rally: 1.5,
  upgrade: 2.5, upgraded: 2.5, outperform: 2, record: 1.5, profit: 1, growth: 1.5,
  gains: 1.5, jumped: 2, breakthrough: 2, approval: 2, approved: 2, wins: 1.5,
  expansion: 1, strong: 1.5, exceeded: 2, raises: 1.5, raised: 1.5, bullish: 2,
  partnership: 1.5, acquisition: 1, dividend: 1, buyback: 2, milestone: 1.5,
};

const NEGATIVE: Record<string, number> = {
  miss: 2, missed: 2, misses: 2, plunge: 2.5, plunged: 2.5, slump: 2, tumble: 2.5,
  downgrade: 2.5, downgraded: 2.5, underperform: 2, loss: 1.5, losses: 1.5,
  lawsuit: 2, probe: 2, investigation: 2, fraud: 3, bankruptcy: 3, default: 2.5,
  layoffs: 2, layoff: 2, cuts: 1.5, warning: 2, warns: 2, weak: 1.5, decline: 1.5,
  fell: 1.5, drop: 1.5, dropped: 1.5, bearish: 2, halt: 2, halted: 2, recall: 2,
  delisting: 3, hack: 2.5, exploit: 2.5, breach: 2, sanction: 2, sanctions: 2,
};

/** Terms that invert the polarity of a nearby sentiment word. */
const NEGATORS = new Set(['not', 'no', 'never', 'without', 'despite', 'avoids', 'avoided']);

interface Classification {
  direction: Direction;
  /** Signed magnitude; positive is bullish. */
  magnitude: number;
  matched: string[];
}

function classify(text: string): Classification {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  let score = 0;
  const matched: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    const pos = POSITIVE[w];
    const neg = NEGATIVE[w];
    if (pos === undefined && neg === undefined) continue;

    // A negator within the preceding three words flips polarity.
    let sign = 1;
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (NEGATORS.has(words[j] as string)) { sign = -1; break; }
    }

    if (pos !== undefined) { score += pos * sign; matched.push(w); }
    else if (neg !== undefined) { score -= (neg as number) * sign; matched.push(w); }
  }

  return {
    direction: score > 0.5 ? 'bullish' : score < -0.5 ? 'bearish' : 'neutral',
    magnitude: score,
    matched,
  };
}

/** Exposed for testing and for the eventual model-backed replacement. */
export const __classify = classify;

export const newsScorer: FactorScorer = {
  factor: 'news',
  weight: 15,

  score(ctx: AssetContext): FactorOutcome {
    const articles = ctx.news;
    if (!articles || articles.length === 0) {
      return { factor: 'news', unavailable: true, reason: 'no articles returned for this asset' };
    }

    const now = Date.now();
    const HALF_LIFE_HOURS = 48;

    let weightedScore = 0;
    let totalWeight = 0;
    let positive = 0;
    let negative = 0;
    let neutral = 0;
    let informative = 0; // articles that matched at least one lexicon term

    const notable: { headline: string; c: Classification; outlet: string; source: string }[] = [];

    for (const a of articles) {
      const text = `${a.headline} ${a.summary ?? ''}`;
      const c = classify(text);

      if (c.direction === 'bullish') positive++;
      else if (c.direction === 'bearish') negative++;
      else neutral++;
      if (c.matched.length > 0) informative++;

      // Exponential recency decay: a week-old headline should not outweigh today's.
      const ageHours = Math.max(0, (now - a.publishedAt.getTime()) / 3_600_000);
      const recency = Math.pow(0.5, ageHours / HALF_LIFE_HOURS);

      weightedScore += c.magnitude * recency;
      totalWeight += recency;

      if (Math.abs(c.magnitude) >= 2) {
        notable.push({ headline: a.headline, c, outlet: a.outlet, source: a.source });
      }
    }

    if (totalWeight === 0) {
      return { factor: 'news', unavailable: true, reason: 'all articles fell outside the recency window' };
    }

    // Normalize the recency-weighted mean magnitude onto 0-100. ±4 is treated as
    // saturation — beyond that the lexicon is not meaningfully more informative.
    const mean = weightedScore / totalWeight;
    const score = Math.max(0, Math.min(100, 50 + (mean / 4) * 50));

    const signals: Signal[] = [
      {
        label: 'Article sentiment mix',
        value: `${positive} positive / ${negative} negative / ${neutral} neutral (${articles.length} articles)`,
        direction: positive > negative * 1.5 ? 'bullish' : negative > positive * 1.5 ? 'bearish' : 'neutral',
        weight: 0.5,
        source: articles[0]?.source ?? 'news',
      },
    ];

    for (const n of notable.sort((a, b) => Math.abs(b.c.magnitude) - Math.abs(a.c.magnitude)).slice(0, 4)) {
      signals.push({
        label: n.headline.length > 110 ? `${n.headline.slice(0, 107)}…` : n.headline,
        value: `${n.outlet} · matched: ${n.c.matched.slice(0, 4).join(', ')}`,
        direction: n.c.direction,
        weight: 0.5 / Math.max(1, notable.length),
        source: n.source,
      });
    }

    // Confidence rises with volume of coverage and with the share of articles the
    // lexicon could actually read, then is capped by the classifier ceiling.
    const volumeConfidence = Math.min(1, articles.length / 12);
    const readability = informative / articles.length;
    const confidence = Math.min(CLASSIFIER_CEILING, volumeConfidence * 0.6 + readability * 0.4);

    return { factor: 'news', score, confidence, signals };
  },
};
