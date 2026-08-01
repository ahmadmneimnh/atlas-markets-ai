/**
 * Alert rule evaluation.
 *
 * Pure functions: a rule plus a market snapshot in, a decision out. No I/O, no
 * database, no clock beyond what is passed in — which is what makes every rule
 * testable and what lets the same logic run in the worker today and in a
 * real-time path later without being rewritten.
 *
 * Three properties are deliberate:
 *
 * 1. **A rule that cannot be evaluated does not fire, and says why.** The
 *    decision type has three states — `fire`, `hold`, `undetermined` — not two.
 *    Collapsing `undetermined` into `hold` means a user whose RSI data has been
 *    missing for a week believes their alert is armed when it is blind.
 *
 * 2. **Crossings need both sides.** An RSI alert at 70 fires when RSI *crosses*
 *    70, which requires the previous reading. Without it the rule is
 *    undetermined rather than firing on every sweep while the value sits above
 *    the threshold — that is the difference between one notification and one
 *    every five minutes.
 *
 * 3. **Cooldown is applied here, not at the delivery edge.** A suppressed alert
 *    is a decision about the rule, and the reason belongs in the same place as
 *    every other reason.
 */

export type AlertType =
  | 'PRICE_ABOVE'
  | 'PRICE_BELOW'
  | 'PERCENT_MOVE'
  | 'VOLUME_SPIKE'
  | 'RSI_ABOVE'
  | 'RSI_BELOW'
  | 'MACD_CROSSOVER'
  | 'GOLDEN_CROSS'
  | 'DEATH_CROSS'
  | 'RECOMMENDATION_CHANGE'
  | 'BREAKING_NEWS'
  | 'SENTIMENT_SHIFT';

export interface AlertRule {
  id: string;
  type: AlertType;
  params: Record<string, unknown>;
  cooldownMinutes: number;
  lastFiredAt?: Date | null;
  enabled: boolean;
}

/**
 * What the evaluator is allowed to see.
 *
 * Every field is optional because every field can genuinely be unavailable, and
 * the type is what forces each rule to handle that rather than reading
 * `undefined` as zero.
 */
export interface MarketSnapshot {
  price?: number;
  previousPrice?: number;
  changePercent?: number;
  volumeRatio?: number;
  rsi?: number;
  previousRsi?: number;
  macdHistogram?: number;
  previousMacdHistogram?: number;
  fastMa?: number;
  slowMa?: number;
  previousFastMa?: number;
  previousSlowMa?: number;
  recommendation?: string;
  previousRecommendation?: string;
  sentiment?: number;
  previousSentiment?: number;
  /** Headlines published since the last evaluation, with relevance 0-1. */
  freshNews?: { headline: string; relevance: number; url: string }[];
}

export type Decision =
  | { status: 'fire'; reason: string; value?: number }
  | { status: 'hold'; reason: string }
  | { status: 'undetermined'; reason: string };

const fire = (reason: string, value?: number): Decision =>
  value === undefined ? { status: 'fire', reason } : { status: 'fire', reason, value };
const hold = (reason: string): Decision => ({ status: 'hold', reason });
const undetermined = (reason: string): Decision => ({ status: 'undetermined', reason });

function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

/** Crossed upward through `threshold` between `previous` and `current`. */
function crossedUp(previous: number, current: number, threshold: number): boolean {
  return previous <= threshold && current > threshold;
}

function crossedDown(previous: number, current: number, threshold: number): boolean {
  return previous >= threshold && current < threshold;
}

const RECOMMENDATION_RANK: Record<string, number> = {
  STRONG_SELL: 0,
  SELL: 1,
  HOLD: 2,
  BUY: 3,
  STRONG_BUY: 4,
};

export function evaluateRule(
  rule: AlertRule,
  snapshot: MarketSnapshot,
  now: Date = new Date(),
): Decision {
  if (!rule.enabled) return hold('Alert is disabled.');

  // Cooldown first: it is cheaper than every other check and it is the only one
  // that can suppress a genuinely true condition.
  if (rule.lastFiredAt) {
    const elapsedMinutes = (now.getTime() - rule.lastFiredAt.getTime()) / 60_000;
    if (elapsedMinutes < rule.cooldownMinutes) {
      return hold(
        `Within cooldown — ${Math.ceil(rule.cooldownMinutes - elapsedMinutes)} minutes remaining.`,
      );
    }
  }

  switch (rule.type) {
    case 'PRICE_ABOVE': {
      const threshold = numberParam(rule.params, 'threshold');
      if (threshold === undefined) return undetermined('Rule has no threshold.');
      if (snapshot.price === undefined) return undetermined('No current price available.');
      return snapshot.price > threshold
        ? fire(`Price ${snapshot.price} is above ${threshold}.`, snapshot.price)
        : hold(`Price ${snapshot.price} is at or below ${threshold}.`);
    }

    case 'PRICE_BELOW': {
      const threshold = numberParam(rule.params, 'threshold');
      if (threshold === undefined) return undetermined('Rule has no threshold.');
      if (snapshot.price === undefined) return undetermined('No current price available.');
      return snapshot.price < threshold
        ? fire(`Price ${snapshot.price} is below ${threshold}.`, snapshot.price)
        : hold(`Price ${snapshot.price} is at or above ${threshold}.`);
    }

    case 'PERCENT_MOVE': {
      const percent = numberParam(rule.params, 'percent');
      if (percent === undefined) return undetermined('Rule has no percent threshold.');
      if (snapshot.changePercent === undefined) {
        return undetermined('No change percentage available.');
      }
      // Absolute value: a "5% move" alert means either direction. A user who
      // wants one direction sets PRICE_ABOVE or PRICE_BELOW.
      return Math.abs(snapshot.changePercent) >= percent
        ? fire(
            `Moved ${snapshot.changePercent.toFixed(2)}%, past the ${percent}% threshold.`,
            snapshot.changePercent,
          )
        : hold(`Moved ${snapshot.changePercent.toFixed(2)}%, under ${percent}%.`);
    }

    case 'VOLUME_SPIKE': {
      const multiple = numberParam(rule.params, 'multiple');
      if (multiple === undefined) return undetermined('Rule has no volume multiple.');
      if (snapshot.volumeRatio === undefined) {
        return undetermined('No volume ratio available — this needs OHLCV history.');
      }
      return snapshot.volumeRatio >= multiple
        ? fire(
            `Volume is ${snapshot.volumeRatio.toFixed(1)}× the 20-bar average.`,
            snapshot.volumeRatio,
          )
        : hold(`Volume is ${snapshot.volumeRatio.toFixed(1)}× average, under ${multiple}×.`);
    }

    case 'RSI_ABOVE': {
      const threshold = numberParam(rule.params, 'threshold');
      if (threshold === undefined) return undetermined('Rule has no RSI threshold.');
      if (snapshot.rsi === undefined) return undetermined('No RSI available.');
      if (snapshot.previousRsi === undefined) {
        // Without the previous reading this becomes a level check, which fires on
        // every sweep for as long as RSI stays above the line.
        return undetermined('No previous RSI, so a crossing cannot be detected.');
      }
      return crossedUp(snapshot.previousRsi, snapshot.rsi, threshold)
        ? fire(
            `RSI crossed above ${threshold} (${snapshot.previousRsi.toFixed(1)} → ${snapshot.rsi.toFixed(1)}).`,
            snapshot.rsi,
          )
        : hold(`RSI ${snapshot.rsi.toFixed(1)} did not cross ${threshold}.`);
    }

    case 'RSI_BELOW': {
      const threshold = numberParam(rule.params, 'threshold');
      if (threshold === undefined) return undetermined('Rule has no RSI threshold.');
      if (snapshot.rsi === undefined) return undetermined('No RSI available.');
      if (snapshot.previousRsi === undefined) {
        return undetermined('No previous RSI, so a crossing cannot be detected.');
      }
      return crossedDown(snapshot.previousRsi, snapshot.rsi, threshold)
        ? fire(
            `RSI crossed below ${threshold} (${snapshot.previousRsi.toFixed(1)} → ${snapshot.rsi.toFixed(1)}).`,
            snapshot.rsi,
          )
        : hold(`RSI ${snapshot.rsi.toFixed(1)} did not cross ${threshold}.`);
    }

    case 'MACD_CROSSOVER': {
      const direction = stringParam(rule.params, 'direction') ?? 'any';
      if (snapshot.macdHistogram === undefined || snapshot.previousMacdHistogram === undefined) {
        return undetermined('MACD histogram needs both a current and a previous reading.');
      }
      const bullish = crossedUp(snapshot.previousMacdHistogram, snapshot.macdHistogram, 0);
      const bearish = crossedDown(snapshot.previousMacdHistogram, snapshot.macdHistogram, 0);

      if (bullish && direction !== 'bearish') {
        return fire(
          'MACD histogram crossed above zero — bullish crossover.',
          snapshot.macdHistogram,
        );
      }
      if (bearish && direction !== 'bullish') {
        return fire(
          'MACD histogram crossed below zero — bearish crossover.',
          snapshot.macdHistogram,
        );
      }
      return hold('No MACD zero-line crossing.');
    }

    case 'GOLDEN_CROSS':
    case 'DEATH_CROSS': {
      const { fastMa, slowMa, previousFastMa, previousSlowMa } = snapshot;
      if (
        fastMa === undefined ||
        slowMa === undefined ||
        previousFastMa === undefined ||
        previousSlowMa === undefined
      ) {
        return undetermined(
          'A moving-average cross needs both averages at two points in time; the series was too short.',
        );
      }
      const wasBelow = previousFastMa <= previousSlowMa;
      const isAbove = fastMa > slowMa;

      if (rule.type === 'GOLDEN_CROSS') {
        return wasBelow && isAbove
          ? fire('Fast moving average crossed above the slow one — golden cross.')
          : hold('No golden cross.');
      }
      return !wasBelow && !isAbove
        ? fire('Fast moving average crossed below the slow one — death cross.')
        : hold('No death cross.');
    }

    case 'RECOMMENDATION_CHANGE': {
      const direction = stringParam(rule.params, 'direction') ?? 'any';
      const { recommendation, previousRecommendation } = snapshot;
      if (!recommendation || !previousRecommendation) {
        return undetermined(
          'A recommendation change needs a stored previous recommendation to compare against.',
        );
      }
      if (recommendation === previousRecommendation) return hold('Recommendation unchanged.');

      const from = RECOMMENDATION_RANK[previousRecommendation];
      const to = RECOMMENDATION_RANK[recommendation];
      if (from === undefined || to === undefined) {
        return undetermined(`Unrecognised recommendation value.`);
      }

      const upgraded = to > from;
      if (direction === 'upgrade' && !upgraded) return hold('Changed, but was a downgrade.');
      if (direction === 'downgrade' && upgraded) return hold('Changed, but was an upgrade.');

      return fire(`Recommendation moved from ${previousRecommendation} to ${recommendation}.`);
    }

    case 'BREAKING_NEWS': {
      const minRelevance = numberParam(rule.params, 'minRelevance') ?? 0.5;
      if (snapshot.freshNews === undefined) {
        return undetermined('No news feed was supplied for this evaluation.');
      }
      const relevant = snapshot.freshNews.filter((n) => n.relevance >= minRelevance);
      return relevant.length > 0
        ? fire(`${relevant.length} new headline(s) above relevance ${minRelevance}.`)
        : hold('No sufficiently relevant new headlines.');
    }

    case 'SENTIMENT_SHIFT': {
      const delta = numberParam(rule.params, 'delta') ?? 0.4;
      if (snapshot.sentiment === undefined || snapshot.previousSentiment === undefined) {
        return undetermined('A sentiment shift needs two readings to compare.');
      }
      const shift = Math.abs(snapshot.sentiment - snapshot.previousSentiment);
      return shift >= delta
        ? fire(`Sentiment moved ${shift.toFixed(2)}, past the ${delta} threshold.`, shift)
        : hold(`Sentiment moved ${shift.toFixed(2)}, under ${delta}.`);
    }

    default: {
      // Exhaustiveness: a new AlertType added to the union without a case here
      // fails the build rather than silently never firing.
      const exhaustive: never = rule.type;
      return undetermined(`No evaluator for alert type ${String(exhaustive)}.`);
    }
  }
}
