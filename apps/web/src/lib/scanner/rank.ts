import type { TradePlan } from '@/lib/analysis/decision';
import type { AssetScore, Recommendation, Signal } from '@/lib/analysis/types';
import type { Quote } from '@/lib/providers/types';

/**
 * The market scanner.
 *
 * Turns a set of scored assets into the three lists a decision actually needs:
 * what to buy, what to hold, what to sell. Pure functions over already-scored
 * input — no I/O — so the ranking rules are testable and the scanner cannot
 * invent an asset the engine never scored.
 *
 * Two rules do the real work here:
 *
 * 1. **Confidence gates the buy and sell lists, and it is not blended into the
 *    score.** A 92/100 built on one factor is not a better opportunity than an
 *    83/100 built on five — it is a less-examined one. Below the floor an asset
 *    is excluded from the actionable lists entirely and reported separately,
 *    because the whole point of a "top opportunities" list is that acting on it
 *    is defensible.
 *
 * 2. **Every entry carries its citations.** An opportunity without the signals
 *    and providers behind it is a tip, and a tip is what this product exists not
 *    to be.
 */

export interface ScannerInput {
  name: string;
  score: AssetScore;
  quote?: Quote;
  plan?: TradePlan;
}

export interface Opportunity {
  name: string;
  symbol: string;
  kind: 'equity' | 'crypto';
  score: number;
  recommendation: Recommendation;
  confidence: number;
  price?: number;
  changePercent?: number;
  currency?: string;
  /** Target from the decision module, when levels could be derived. */
  target?: number;
  /**
   * Move from the current price to the target, as a percentage.
   *
   * Signed rather than split into separate upside/downside fields: a sell's
   * target is below spot and the negative number is the answer. Present only
   * when both a price and a target exist — deriving it from one of them would
   * mean inventing the other.
   */
  potentialPercent?: number;
  /** Risk level from the plan, which takes it from the score's risk assessment. */
  riskLevel?: 'low' | 'medium' | 'high';
  /** The highest-impact signals behind this score. Never empty for a ranked entry. */
  citations: Signal[];
  /** Distinct provider ids that contributed. */
  providers: string[];
  computedAt: Date;
}

export interface ScannerResult {
  /** STRONG_BUY and BUY, best first. */
  buy: Opportunity[];
  /** HOLD, best first — the "nothing to do here" list, which is still an answer. */
  hold: Opportunity[];
  /** SELL and STRONG_SELL, worst first: the strongest sell signal leads. */
  sell: Opportunity[];
  /**
   * Every scored asset in one ordering, strongest buy first and strongest sell
   * last.
   *
   * Not truncated by `limit`, and not filtered by the confidence floor — this is
   * the complete ranking, and an asset held back from the actionable lists still
   * has a place in it with its confidence shown. Omitting those rows would make
   * the list look like the whole universe while quietly being a subset.
   */
  ranked: Opportunity[];
  /** Everything grouped by band, for a complete view. */
  byBand: Record<Recommendation, Opportunity[]>;
  /**
   * Scored, but below the confidence floor for an actionable list. Surfaced
   * rather than dropped — a thin-evidence result is information about coverage.
   */
  lowConfidence: Opportunity[];
  scannedAt: Date;
  /** How many assets the engine could score at all, out of how many were tried. */
  coverage: { scored: number; attempted: number };
}

/**
 * Minimum confidence for a place on the buy or sell lists.
 *
 * 45 rather than a round 50 because the engine's own confidence already
 * incorporates coverage; a second aggressive filter on top of it would empty the
 * lists on a deployment with two providers configured, which is the common case.
 */
export const ACTIONABLE_CONFIDENCE = 45;

const BANDS: Recommendation[] = ['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL'];

function toOpportunity(input: ScannerInput): Opportunity {
  const { score, quote, plan } = input;

  const opportunity: Opportunity = {
    name: input.name,
    symbol: score.ref.symbol,
    kind: score.ref.kind,
    score: score.score,
    recommendation: score.recommendation,
    confidence: score.confidence,
    citations: score.topReasons,
    providers: score.sources,
    computedAt: score.computedAt,
  };

  if (quote) {
    opportunity.price = quote.price;
    opportunity.changePercent = quote.changePercent;
    if (quote.currency) opportunity.currency = quote.currency;
  }

  if (plan) {
    opportunity.target = plan.target.price;
    opportunity.riskLevel = plan.riskLevel;
    // Measured against the plan's own current price, not the quote's. They are
    // normally the same value, but the plan falls back to the last close when no
    // live quote exists, and mixing the two would state a percentage between two
    // prices observed at different times.
    if (plan.currentPrice > 0) {
      opportunity.potentialPercent =
        ((plan.target.price - plan.currentPrice) / plan.currentPrice) * 100;
    }
  }

  return opportunity;
}

/**
 * Ranks scored assets into actionable lists.
 *
 * `attempted` is passed in rather than inferred from the input length: the
 * caller knows how many assets it tried to score, and the difference between
 * that and what came back is the coverage figure a reader needs to judge the
 * list. Inferring it from `scored.length` would always report 100%.
 */
export function scan(scored: ScannerInput[], attempted: number, limit = 5): ScannerResult {
  const all = scored.map(toOpportunity);

  const byBand = Object.fromEntries(BANDS.map((band) => [band, [] as Opportunity[]])) as Record<
    Recommendation,
    Opportunity[]
  >;
  for (const item of all) byBand[item.recommendation].push(item);
  for (const band of BANDS) byBand[band].sort((a, b) => b.score - a.score);

  const actionable = all.filter((item) => item.confidence >= ACTIONABLE_CONFIDENCE);
  const lowConfidence = all
    .filter((item) => item.confidence < ACTIONABLE_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);

  const buy = actionable
    .filter((item) => item.recommendation === 'STRONG_BUY' || item.recommendation === 'BUY')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Holds are ranked by score too, so the strongest hold — the one closest to
  // becoming a buy — is at the top. Ranking them by confidence instead would
  // lead with the best-understood non-opportunity, which is not what a reader
  // scanning this list is looking for.
  const hold = actionable
    .filter((item) => item.recommendation === 'HOLD')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Ascending: the strongest sell signal is the *lowest* score.
  const sell = actionable
    .filter((item) => item.recommendation === 'SELL' || item.recommendation === 'STRONG_SELL')
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);

  // Descending score is exactly "strongest buy → strongest sell": the bands are
  // score ranges, so one sort produces the full spectrum without special-casing
  // the sell end the way the truncated `sell` list has to.
  const ranked = [...all].sort((a, b) => b.score - a.score);

  return {
    buy,
    hold,
    sell,
    ranked,
    byBand,
    lowConfidence,
    scannedAt: new Date(),
    coverage: { scored: all.length, attempted },
  };
}

/**
 * A one-line, non-fabricated justification for an opportunity.
 *
 * Built by naming the strongest cited signal and its provider — not by
 * generating prose. If there is no citation there is no summary, because a
 * sentence with nothing behind it is exactly the thing this product refuses to
 * produce.
 */
export function citationSummary(opportunity: Opportunity): string | undefined {
  const [top] = opportunity.citations;
  if (!top) return undefined;
  return `${top.label} ${top.value} (${top.source})`;
}
