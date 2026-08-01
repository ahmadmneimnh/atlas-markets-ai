import { atr, rangeStats, rsi, sma, supportResistance, volatility } from './indicators';
import type { AssetContext, AssetScore, Recommendation, RiskAssessment } from './types';

/**
 * The investment decision module: what to do, why, where to get in, where to take
 * profit, where to admit the thesis was wrong.
 *
 * A score of 78/100 is not a decision. It becomes one only when it carries a
 * price to act at, a level to leave at, and a level that falsifies it — and this
 * module's entire job is to derive those three numbers from measured market data
 * rather than to produce plausible-looking ones.
 *
 * Three rules make that guarantee real:
 *
 *  1. **Every level is a stated formula over observed inputs.** Not "suggested
 *     entry $184.20" but "1.0 × ATR(14) below the current price, floored at the
 *     nearest pivot support" — with ATR, the price and the support level all
 *     shown, each tagged with the provider it came from. A reader can recompute
 *     any number on the page by hand.
 *
 *  2. **No ATR, no plan.** A stop-loss is a volatility statement: it says how much
 *     adverse movement is normal noise rather than evidence. Without a measured
 *     volatility there is no non-arbitrary place to put one, and a stop picked out
 *     of the air ("8% below") is precisely the fabricated number this product
 *     refuses to print. The module returns `Insufficient data for recommendation`
 *     instead.
 *
 *  3. **Risk level is not recomputed here.** It is taken from the score's existing
 *     `RiskAssessment`, which is already derived from volatility, drawdown and
 *     ATR. Deriving a second, independently-banded risk level would let the same
 *     asset display "Low" in one panel and "Medium" in another, and a reader has
 *     no way to know which to believe.
 */

// ── Tunables, stated once so the prose and the arithmetic cannot diverge ────────

/** ATR multiples for how far below price a long entry waits, keyed on RSI. */
const PULLBACK_ATR = {
  /** RSI ≥ 70. Extended; the module will not recommend buying at market. */
  extended: 1.5,
  /** RSI 55–70. Firm but not stretched. */
  firm: 1.0,
  /** RSI 40–55. Mid-range. */
  neutral: 0.75,
  /** RSI < 40. Already washed out; waiting for a deep pullback misses the setup. */
  washedOut: 0.5,
} as const;

/** When RSI is at an extreme, the near edge of the zone steps away from market. */
const EXTREME_OFFSET_ATR = 0.5;
/** A zone thinner than this is a line, not a range, and cannot be worked. */
const MIN_ZONE_ATR = 0.25;
/** Distance below a structural level at which a stop sits, so a wick does not take it. */
const STOP_BUFFER_ATR = 0.25;
/** Pure-volatility stop distance from the far edge of the entry zone. */
const VOLATILITY_STOP_ATR = 2;
/** Inside this distance a level is indistinguishable from noise. */
const NOISE_ATR = 1;
/** Projection used as the target of last resort when no structure lies ahead. */
const MEASURED_MOVE_ATR = 3;
/** Reward-to-risk below which the module looks past a nearby level to the next. */
const MIN_RISK_REWARD = 1.5;

export const INSUFFICIENT_DATA_MESSAGE = 'Insufficient data for recommendation';

// ── Types ───────────────────────────────────────────────────────────────────────

/**
 * One observed input behind a derived level.
 *
 * Structurally close to `Signal` but deliberately separate: a Signal carries a
 * `direction` and a scoring `weight`, which are meaningless for "the ATR was
 * 3.42". Reusing it would mean inventing a direction for a measurement that has
 * none.
 */
export interface LevelInput {
  label: string;
  value: string;
  /** Provider id the underlying datum came from. */
  source: string;
}

export interface EntryZone {
  low: number;
  high: number;
  /** The rule actually applied, with its numbers. Never a generic description. */
  method: string;
  inputs: LevelInput[];
}

export interface PriceLevel {
  price: number;
  method: string;
  inputs: LevelInput[];
}

/**
 * What the plan is for. Derived from the recommendation band, and distinct from
 * it because HOLD needs levels that are explicitly *not* a call to act.
 */
export type Stance = 'long' | 'exit' | 'watch';

export interface TradePlan {
  action: Recommendation;
  stance: Stance;
  /** 0–100, carried through from the score. Never blended into the levels. */
  confidence: number;
  currentPrice: number;
  priceSource: string;
  priceAsOf: Date;
  currency?: string;
  entry: EntryZone;
  target: PriceLevel;
  stop: PriceLevel;
  /** Taken from the score's risk assessment, not recomputed. */
  riskLevel: RiskAssessment['severity'];
  /** Reward divided by risk, measured from the midpoint of the entry zone. */
  riskReward: number;
  /** True when no level ahead cleared MIN_RISK_REWARD and the furthest was used. */
  riskRewardBelowTarget: boolean;
  /** Inputs the plan wanted but did not have, named so the gap is visible. */
  missing: string[];
  computedAt: Date;
}

export interface PlanUnavailable {
  ok: false;
  /** Shown to the reader verbatim. */
  message: string;
  /** Which specific inputs were absent. */
  missing: string[];
}

export type PlanOutcome = { ok: true; plan: TradePlan } | PlanUnavailable;

// ── Helpers ─────────────────────────────────────────────────────────────────────

const num = (n: number): string =>
  Math.abs(n) >= 1000 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(4);

function pullbackMultiple(r: number | undefined): number {
  if (r === undefined) return PULLBACK_ATR.firm;
  if (r >= 70) return PULLBACK_ATR.extended;
  if (r >= 55) return PULLBACK_ATR.firm;
  if (r >= 40) return PULLBACK_ATR.neutral;
  return PULLBACK_ATR.washedOut;
}

/**
 * The mirror of `pullbackMultiple` for an exit.
 *
 * Inverted around 50 rather than reusing the same table: an oversold reading
 * argues for patience when *selling* exactly as an overbought reading argues for
 * patience when buying. Sharing one table would have a washed-out asset
 * recommend dumping into the hole at market.
 */
function rallyMultiple(r: number | undefined): number {
  if (r === undefined) return PULLBACK_ATR.firm;
  if (r <= 30) return PULLBACK_ATR.extended;
  if (r <= 45) return PULLBACK_ATR.firm;
  if (r <= 60) return PULLBACK_ATR.neutral;
  return PULLBACK_ATR.washedOut;
}

export function stanceOf(action: Recommendation): Stance {
  if (action === 'BUY' || action === 'STRONG_BUY') return 'long';
  if (action === 'SELL' || action === 'STRONG_SELL') return 'exit';
  return 'watch';
}

interface Candidate {
  price: number;
  label: string;
  source: string;
}

// ── The plan ────────────────────────────────────────────────────────────────────

/**
 * Derives entry, target and stop from price history and the existing score.
 *
 * Pure: every input is a parameter, so the arithmetic is testable without a
 * network, and the module cannot reach for a provider that would let it invent a
 * level the caller never saw.
 */
export function buildTradePlan(ctx: AssetContext, score: AssetScore): PlanOutcome {
  // Read from the context rather than taken as a parameter: the plan must be
  // built from exactly the evidence the score saw. A separate argument would let
  // a caller hand the target selector an analyst target the fundamental factor
  // never scored, and the two would disagree on the same page.
  const analyst = ctx.analyst;
  const missing: string[] = [];

  const series = ctx.ohlcv;
  if (!series || series.candles.length === 0) {
    return {
      ok: false,
      message: INSUFFICIENT_DATA_MESSAGE,
      missing: ['price history (OHLCV) — no entry, target or stop can be derived without it'],
    };
  }

  const candles = series.candles;
  const closes = candles.map((c) => c.close);
  const src = series.source;

  // Prefer the live quote; fall back to the last close, saying which was used.
  const lastClose = closes[closes.length - 1] as number;
  const price = ctx.quote?.price ?? lastClose;
  const priceSource = ctx.quote?.source ?? src;
  const priceAsOf = ctx.quote?.asOf ?? series.asOf;
  if (!ctx.quote) missing.push('live quote — levels are anchored to the last daily close');

  if (!(price > 0)) {
    return {
      ok: false,
      message: INSUFFICIENT_DATA_MESSAGE,
      missing: ['a positive current price'],
    };
  }

  // Rule 2: without a volatility measure there is no non-arbitrary stop.
  const a = atr(candles, 14);
  if (a === undefined || !(a > 0)) {
    return {
      ok: false,
      message: INSUFFICIENT_DATA_MESSAGE,
      missing: [
        `ATR(14) — needs 15 daily bars, ${candles.length} available; a stop-loss without a measured volatility would be an invented number`,
      ],
    };
  }

  const r = rsi(closes, 14);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const vol = volatility(closes, 30);
  const range = rangeStats(candles);
  const pivots = supportResistance(candles);

  if (r === undefined) missing.push('RSI(14) — entry offset falls back to a neutral 1.0 × ATR');
  if (sma20 === undefined && sma50 === undefined) {
    missing.push('moving averages — no SMA(20)/SMA(50) magnet was available to shape the zone');
  }
  if (vol === undefined) missing.push('30-day annualised volatility');

  // Re-filter against the plan's price: `supportResistance` filters against the
  // last close, and an intraday quote may have moved through a level since.
  const supports = pivots.support.filter((level) => level < price);
  const resistances = pivots.resistance.filter((level) => level > price);
  if (supports.length === 0) missing.push('pivot support below the current price');
  if (resistances.length === 0) missing.push('pivot resistance above the current price');

  const stance = stanceOf(score.recommendation);
  // A watch plan is scaffolding for a long that is not yet warranted, so it uses
  // the long-side geometry. The UI labels it as a level to wait for, not to act on.
  const long = stance !== 'exit';

  const atrInput: LevelInput = { label: 'ATR(14)', value: num(a), source: src };
  const priceInput: LevelInput = {
    label: 'Current price',
    value: num(price),
    source: priceSource,
  };

  // ── Entry zone ────────────────────────────────────────────────────────────
  const entryInputs: LevelInput[] = [priceInput, atrInput];
  if (r !== undefined) {
    entryInputs.push({ label: 'RSI(14)', value: r.toFixed(1), source: src });
  }

  const multiple = long ? pullbackMultiple(r) : rallyMultiple(r);
  const depth = multiple * a;

  let low: number;
  let high: number;
  let method: string;

  if (long) {
    // At RSI ≥ 70 the whole zone steps below market: the module will not tell a
    // reader to buy an extended move at any price it can see.
    const stretched = r !== undefined && r >= 70;
    high = price - (stretched ? EXTREME_OFFSET_ATR * a : 0);
    low = high - depth;

    // A support or moving average inside the zone is where price is likely to be
    // met, so it raises the floor — there is no reason to wait below it.
    const floors = [supports.length > 0 ? Math.max(...supports) : undefined, sma20, sma50].filter(
      (level): level is number => level !== undefined && level > low && level < high,
    );

    if (floors.length > 0) {
      const floor = Math.max(...floors);
      low = floor;
      const named: string[] = [];
      if (supports.includes(floor)) named.push('pivot support');
      if (floor === sma20) named.push('SMA(20)');
      if (floor === sma50) named.push('SMA(50)');
      method =
        `${multiple.toFixed(2)} × ATR(14) below ${stretched ? 'a price 0.5 × ATR under market' : 'the current price'}, ` +
        `floored at ${named.join(' / ') || 'the nearest level'} at ${num(floor)}`;
    } else {
      method =
        `${multiple.toFixed(2)} × ATR(14) below ${stretched ? 'a price 0.5 × ATR under market' : 'the current price'}` +
        ` (RSI ${r === undefined ? 'unavailable' : r.toFixed(1)})`;
    }

    if (high - low < MIN_ZONE_ATR * a) low = high - MIN_ZONE_ATR * a;
  } else {
    const washedOut = r !== undefined && r <= 30;
    low = price + (washedOut ? EXTREME_OFFSET_ATR * a : 0);
    high = low + depth;

    const ceilings = [
      resistances.length > 0 ? Math.min(...resistances) : undefined,
      sma20,
      sma50,
    ].filter((level): level is number => level !== undefined && level > low && level < high);

    if (ceilings.length > 0) {
      const ceiling = Math.min(...ceilings);
      high = ceiling;
      const named: string[] = [];
      if (resistances.includes(ceiling)) named.push('pivot resistance');
      if (ceiling === sma20) named.push('SMA(20)');
      if (ceiling === sma50) named.push('SMA(50)');
      method =
        `${multiple.toFixed(2)} × ATR(14) above ${washedOut ? 'a price 0.5 × ATR over market' : 'the current price'}, ` +
        `capped at ${named.join(' / ') || 'the nearest level'} at ${num(ceiling)}`;
    } else {
      method =
        `${multiple.toFixed(2)} × ATR(14) above ${washedOut ? 'a price 0.5 × ATR over market' : 'the current price'}` +
        ` (RSI ${r === undefined ? 'unavailable' : r.toFixed(1)})`;
    }

    if (high - low < MIN_ZONE_ATR * a) high = low + MIN_ZONE_ATR * a;
  }

  for (const [label, value] of [
    ['SMA(20)', sma20],
    ['SMA(50)', sma50],
  ] as const) {
    if (value !== undefined) entryInputs.push({ label, value: num(value), source: src });
  }
  if (long && supports.length > 0) {
    entryInputs.push({
      label: 'Nearest pivot support',
      value: num(Math.max(...supports)),
      source: src,
    });
  }
  if (!long && resistances.length > 0) {
    entryInputs.push({
      label: 'Nearest pivot resistance',
      value: num(Math.min(...resistances)),
      source: src,
    });
  }

  const entry: EntryZone = { low, high, method, inputs: entryInputs };
  const mid = (low + high) / 2;

  // ── Stop ──────────────────────────────────────────────────────────────────
  // Structural first, volatility as the fallback. A structural stop is used only
  // when it sits outside the noise band (so ordinary chop does not trigger it)
  // and no wider than the volatility stop (so an unrelated level far below does
  // not turn a defined risk into an open-ended one).
  const stopInputs: LevelInput[] = [atrInput];
  const farEdge = long ? low : high;
  const volatilityStop = long
    ? farEdge - VOLATILITY_STOP_ATR * a
    : farEdge + VOLATILITY_STOP_ATR * a;

  const structuralLevels = long
    ? supports.filter((level) => level < farEdge)
    : resistances.filter((level) => level > farEdge);

  let stopPrice = volatilityStop;
  let stopMethod =
    `${VOLATILITY_STOP_ATR} × ATR(14) ${long ? 'below' : 'above'} the far edge of the entry zone ` +
    `(${num(farEdge)} ${long ? '−' : '+'} ${num(VOLATILITY_STOP_ATR * a)})`;

  if (structuralLevels.length > 0) {
    const nearest = long ? Math.max(...structuralLevels) : Math.min(...structuralLevels);
    const structural = long ? nearest - STOP_BUFFER_ATR * a : nearest + STOP_BUFFER_ATR * a;
    const outsideNoise = Math.abs(farEdge - structural) >= NOISE_ATR * a;
    const notWider = long ? structural >= volatilityStop : structural <= volatilityStop;

    stopInputs.push({
      label: `Pivot ${long ? 'support' : 'resistance'} below entry`,
      value: num(nearest),
      source: src,
    });

    if (outsideNoise && notWider) {
      stopPrice = structural;
      stopMethod =
        `${STOP_BUFFER_ATR} × ATR(14) ${long ? 'below' : 'above'} the pivot ` +
        `${long ? 'support' : 'resistance'} at ${num(nearest)} — outside the ${NOISE_ATR} × ATR noise band, ` +
        `and tighter than the ${VOLATILITY_STOP_ATR} × ATR volatility stop at ${num(volatilityStop)}`;
    } else if (!outsideNoise) {
      stopMethod += `; the pivot at ${num(nearest)} was rejected as inside the ${NOISE_ATR} × ATR noise band`;
    } else {
      stopMethod += `; the pivot at ${num(nearest)} was rejected as wider than a ${VOLATILITY_STOP_ATR} × ATR stop`;
    }
  }

  if (long && stopPrice <= 0) {
    return {
      ok: false,
      message: INSUFFICIENT_DATA_MESSAGE,
      missing: [
        `a placeable stop — ${VOLATILITY_STOP_ATR} × ATR(14) (${num(VOLATILITY_STOP_ATR * a)}) exceeds the price itself (${num(price)}), so no level below zero can bound the risk`,
      ],
    };
  }

  const risk = Math.abs(mid - stopPrice);
  if (!(risk > 0)) {
    return {
      ok: false,
      message: INSUFFICIENT_DATA_MESSAGE,
      missing: ['a stop distinguishable from the entry price'],
    };
  }

  const stop: PriceLevel = { price: stopPrice, method: stopMethod, inputs: stopInputs };

  // ── Target ────────────────────────────────────────────────────────────────
  // Observed levels are ranked ahead of the volatility projection, and not merely
  // sorted together with it by distance. A pivot high is somewhere price has
  // actually turned and a sell-side target is somewhere analysts are actually
  // published; a measured move is neither — it is arithmetic on ATR. Letting the
  // projection win just for being nearer would quietly replace evidence with a
  // formula, and the reader would see "Target $102" with no way to tell which
  // kind of claim it was.
  const observed: Candidate[] = [];
  const ahead = (level: number): boolean => (long ? level > mid : level < mid);

  for (const level of long ? resistances : supports) {
    if (ahead(level)) {
      observed.push({
        price: level,
        label: `Pivot ${long ? 'resistance' : 'support'}`,
        source: src,
      });
    }
  }

  if (analyst?.targetConsensus !== undefined && ahead(analyst.targetConsensus)) {
    observed.push({
      price: analyst.targetConsensus,
      label: 'Analyst consensus target',
      source: analyst.source,
    });
  }

  if (range) {
    const extreme = long ? range.high52w : range.low52w;
    if (ahead(extreme)) {
      observed.push({
        price: extreme,
        label: long ? '52-week high' : '52-week low',
        source: src,
      });
    }
  }

  // Nearest first, in the direction of the trade: the first level price has to
  // get through is the one most likely to stall it.
  observed.sort((x, y) => (long ? x.price - y.price : y.price - x.price));

  // The fallback, so a target still exists at an all-time high where nothing lies
  // ahead. Labelled as a projection rather than dressed up as a level.
  const projectedPrice = long ? mid + MEASURED_MOVE_ATR * a : mid - MEASURED_MOVE_ATR * a;
  const projection: Candidate | undefined =
    projectedPrice > 0
      ? {
          price: projectedPrice,
          label: `Measured move (${MEASURED_MOVE_ATR} × ATR from entry midpoint)`,
          source: src,
        }
      : undefined;

  const candidates = projection ? [...observed, projection] : observed;
  if (candidates.length === 0) {
    return {
      ok: false,
      message: INSUFFICIENT_DATA_MESSAGE,
      missing: ['any price level ahead of the entry zone to target'],
    };
  }

  const rrOf = (level: number): number => Math.abs(level - mid) / risk;

  // Preference order: nearest observed level that pays for the risk; else the
  // projection if it does; else whichever candidate lies furthest ahead, with the
  // shortfall reported rather than hidden.
  const clearedObserved = observed.find((c) => rrOf(c.price) >= MIN_RISK_REWARD);
  const furthest = candidates.reduce((best, c) =>
    Math.abs(c.price - mid) > Math.abs(best.price - mid) ? c : best,
  );

  let chosen: Candidate;
  let targetMethod: string;
  if (clearedObserved) {
    chosen = clearedObserved;
    targetMethod =
      `Nearest observed level ahead of the entry that clears ${MIN_RISK_REWARD}:1 reward-to-risk — ` +
      `${chosen.label} at ${num(chosen.price)}`;
  } else if (projection && rrOf(projection.price) >= MIN_RISK_REWARD) {
    chosen = projection;
    targetMethod =
      `No observed level ahead cleared ${MIN_RISK_REWARD}:1, so the volatility projection was used — ` +
      `${projection.label} at ${num(projection.price)}. This is arithmetic on ATR, not a level price has respected.`;
  } else {
    chosen = furthest;
    targetMethod =
      `Nothing ahead cleared ${MIN_RISK_REWARD}:1; the furthest candidate was used — ` +
      `${chosen.label} at ${num(chosen.price)}`;
  }

  const riskReward = rrOf(chosen.price);
  const belowTarget = riskReward < MIN_RISK_REWARD;

  const target: PriceLevel = {
    price: chosen.price,
    method: targetMethod,
    inputs: candidates.map((c) => ({ label: c.label, value: num(c.price), source: c.source })),
  };

  if (analyst?.targetConsensus === undefined) {
    missing.push('analyst price targets — no sell-side consensus was available for this asset');
  }

  const plan: TradePlan = {
    action: score.recommendation,
    stance,
    confidence: score.confidence,
    currentPrice: price,
    priceSource,
    priceAsOf,
    entry,
    target,
    stop,
    riskLevel: score.risk.severity,
    riskReward,
    riskRewardBelowTarget: belowTarget,
    missing,
    computedAt: new Date(),
  };

  if (ctx.quote?.currency) plan.currency = ctx.quote.currency;

  return { ok: true, plan };
}
