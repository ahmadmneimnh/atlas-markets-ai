import type { Candle } from '@/lib/providers/types';

/**
 * Technical indicators — pure functions over price series. No I/O, no framework.
 *
 * Conventions across this module:
 *  - Series are ordered oldest → newest.
 *  - A result is `undefined` when there is not enough history to compute it. It is
 *    never zero-filled or back-filled: an indicator that silently returns 0 for the
 *    first 13 bars of an RSI(14) produces "extremely oversold" signals on every
 *    newly listed asset.
 *  - Wilder's smoothing is used for RSI/ATR/ADX (as in the original definitions),
 *    not a simple average, since the two diverge materially on trending data.
 */

// ── Moving averages ─────────────────────────────────────────────────────────────

export function sma(values: number[], period: number): number | undefined {
  if (period <= 0 || values.length < period) return undefined;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i] as number;
  return sum / period;
}

/** Full EMA series, seeded with the SMA of the first `period` values. */
export function emaSeries(values: number[], period: number): number[] {
  if (period <= 0 || values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i] as number;
  let prev = seed / period;
  out.push(prev);

  for (let i = period; i < values.length; i++) {
    prev = (values[i] as number) * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function ema(values: number[], period: number): number | undefined {
  const series = emaSeries(values, period);
  return series.length > 0 ? series[series.length - 1] : undefined;
}

// ── RSI ─────────────────────────────────────────────────────────────────────────

/** Wilder's RSI. Returns undefined with fewer than `period + 1` closes. */
export function rsi(closes: number[], period = 14): number | undefined {
  if (closes.length < period + 1) return undefined;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = (closes[i] as number) - (closes[i - 1] as number);
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = (closes[i] as number) - (closes[i - 1] as number);
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  // A run with no down-closes has infinite RS; RSI is 100 by definition.
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── MACD ────────────────────────────────────────────────────────────────────────

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
  /** Sign change in the histogram on the most recent bar. */
  crossover: 'bullish' | 'bearish' | null;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult | undefined {
  if (closes.length < slow + signalPeriod) return undefined;

  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);
  if (fastSeries.length === 0 || slowSeries.length === 0) return undefined;

  // The fast EMA starts (slow - fast) bars earlier; align to the slow series.
  const offset = fastSeries.length - slowSeries.length;
  const macdLine: number[] = [];
  for (let i = 0; i < slowSeries.length; i++) {
    macdLine.push((fastSeries[i + offset] as number) - (slowSeries[i] as number));
  }

  const signalSeries = emaSeries(macdLine, signalPeriod);
  if (signalSeries.length < 2) return undefined;

  const sigOffset = macdLine.length - signalSeries.length;
  const last = signalSeries.length - 1;

  const macdNow = macdLine[last + sigOffset] as number;
  const macdPrev = macdLine[last - 1 + sigOffset] as number;
  const signalNow = signalSeries[last] as number;
  const signalPrev = signalSeries[last - 1] as number;

  const histNow = macdNow - signalNow;
  const histPrev = macdPrev - signalPrev;

  let crossover: 'bullish' | 'bearish' | null = null;
  if (histPrev <= 0 && histNow > 0) crossover = 'bullish';
  else if (histPrev >= 0 && histNow < 0) crossover = 'bearish';

  return { macd: macdNow, signal: signalNow, histogram: histNow, crossover };
}

// ── Bollinger Bands ─────────────────────────────────────────────────────────────

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  /** 0 = at lower band, 1 = at upper band. Outside [0,1] means a band breach. */
  percentB: number;
  /** Band width relative to the mean — a squeeze indicator. */
  bandwidth: number;
}

export function bollinger(closes: number[], period = 20, stdDevs = 2): BollingerResult | undefined {
  const middle = sma(closes, period);
  if (middle === undefined) return undefined;

  const window = closes.slice(-period);
  let variance = 0;
  for (const v of window) variance += (v - middle) ** 2;
  const sd = Math.sqrt(variance / period);

  const upper = middle + stdDevs * sd;
  const lower = middle - stdDevs * sd;
  const price = closes[closes.length - 1] as number;

  return {
    upper,
    middle,
    lower,
    percentB: upper === lower ? 0.5 : (price - lower) / (upper - lower),
    bandwidth: middle === 0 ? 0 : (upper - lower) / middle,
  };
}

// ── True range family ───────────────────────────────────────────────────────────

function trueRanges(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i] as Candle;
    const prevClose = (candles[i - 1] as Candle).close;
    out.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  return out;
}

/** Wilder-smoothed running average, used by ATR and ADX. */
function wilderSmooth(values: number[], period: number): number[] {
  if (values.length < period) return [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i] as number;
  let prev = sum / period;

  const out = [prev];
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + (values[i] as number)) / period;
    out.push(prev);
  }
  return out;
}

export function atr(candles: Candle[], period = 14): number | undefined {
  const tr = trueRanges(candles);
  const smoothed = wilderSmooth(tr, period);
  return smoothed.length > 0 ? smoothed[smoothed.length - 1] : undefined;
}

// ── ADX ─────────────────────────────────────────────────────────────────────────

export interface AdxResult {
  adx: number;
  plusDi: number;
  minusDi: number;
}

export function adx(candles: Candle[], period = 14): AdxResult | undefined {
  // ADX needs `period` bars to smooth DI, then another `period` to smooth DX.
  if (candles.length < period * 2 + 1) return undefined;

  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i] as Candle;
    const prev = candles[i - 1] as Candle;
    const up = cur.high - prev.high;
    const down = prev.low - cur.low;
    // Directional movement counts only when one side clearly dominates.
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }

  const tr = wilderSmooth(trueRanges(candles), period);
  const plus = wilderSmooth(plusDm, period);
  const minus = wilderSmooth(minusDm, period);
  if (tr.length === 0 || plus.length === 0 || minus.length === 0) return undefined;

  const dx: number[] = [];
  for (let i = 0; i < tr.length; i++) {
    const t = tr[i] as number;
    if (t === 0) {
      dx.push(0);
      continue;
    }
    const pDi = 100 * ((plus[i] as number) / t);
    const mDi = 100 * ((minus[i] as number) / t);
    const denom = pDi + mDi;
    dx.push(denom === 0 ? 0 : (100 * Math.abs(pDi - mDi)) / denom);
  }

  const adxSeries = wilderSmooth(dx, period);
  if (adxSeries.length === 0) return undefined;

  const lastTr = tr[tr.length - 1] as number;
  return {
    adx: adxSeries[adxSeries.length - 1] as number,
    plusDi: lastTr === 0 ? 0 : 100 * ((plus[plus.length - 1] as number) / lastTr),
    minusDi: lastTr === 0 ? 0 : 100 * ((minus[minus.length - 1] as number) / lastTr),
  };
}

// ── VWAP ────────────────────────────────────────────────────────────────────────

/**
 * Volume-weighted average price over the provided window.
 *
 * Returns undefined when total volume is zero — some providers (CoinGecko's /ohlc)
 * omit volume entirely, and dividing by zero there would yield NaN or, worse, a
 * plain average silently presented as VWAP.
 */
export function vwap(candles: Candle[]): number | undefined {
  if (candles.length === 0) return undefined;
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }
  return vol > 0 ? pv / vol : undefined;
}

// ── Ichimoku ────────────────────────────────────────────────────────────────────

export interface IchimokuResult {
  tenkan: number;
  kijun: number;
  senkouA: number;
  senkouB: number;
  /** Where price sits relative to the cloud. */
  position: 'above' | 'inside' | 'below';
}

function midpoint(candles: Candle[], period: number): number | undefined {
  if (candles.length < period) return undefined;
  const window = candles.slice(-period);
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of window) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  return (hi + lo) / 2;
}

export function ichimoku(candles: Candle[]): IchimokuResult | undefined {
  const tenkan = midpoint(candles, 9);
  const kijun = midpoint(candles, 26);
  const senkouB = midpoint(candles, 52);
  if (tenkan === undefined || kijun === undefined || senkouB === undefined) return undefined;

  const senkouA = (tenkan + kijun) / 2;
  const price = (candles[candles.length - 1] as Candle).close;
  const top = Math.max(senkouA, senkouB);
  const bottom = Math.min(senkouA, senkouB);

  return {
    tenkan,
    kijun,
    senkouA,
    senkouB,
    position: price > top ? 'above' : price < bottom ? 'below' : 'inside',
  };
}

// ── Structure ───────────────────────────────────────────────────────────────────

export interface RangeStats {
  high52w: number;
  low52w: number;
  /** 0 = at the 52-week low, 1 = at the 52-week high. */
  positionInRange: number;
}

export function rangeStats(candles: Candle[]): RangeStats | undefined {
  if (candles.length === 0) return undefined;
  // ~252 trading days; crypto series are daily too, so the window is comparable.
  const window = candles.slice(-252);
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of window) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  const price = (candles[candles.length - 1] as Candle).close;
  return {
    high52w: hi,
    low52w: lo,
    positionInRange: hi === lo ? 0.5 : (price - lo) / (hi - lo),
  };
}

export type CrossSignal = 'golden' | 'death' | null;

/**
 * Golden/death cross on the 50/200 SMA, detected only on the bar where it happens.
 * Reporting a cross that occurred months ago as current news would be misleading,
 * so this compares the current and previous bar rather than just the current sign.
 */
export function maCross(closes: number[], fast = 50, slow = 200): CrossSignal {
  if (closes.length < slow + 1) return null;

  const prevCloses = closes.slice(0, -1);
  const fastNow = sma(closes, fast);
  const slowNow = sma(closes, slow);
  const fastPrev = sma(prevCloses, fast);
  const slowPrev = sma(prevCloses, slow);
  if (
    fastNow === undefined ||
    slowNow === undefined ||
    fastPrev === undefined ||
    slowPrev === undefined
  ) {
    return null;
  }

  if (fastPrev <= slowPrev && fastNow > slowNow) return 'golden';
  if (fastPrev >= slowPrev && fastNow < slowNow) return 'death';
  return null;
}

/**
 * Support and resistance from local extrema (fractal pivots), clustered so that a
 * dozen near-identical levels collapse into one.
 */
export function supportResistance(
  candles: Candle[],
  lookback = 2,
): { support: number[]; resistance: number[] } {
  const support: number[] = [];
  const resistance: number[] = [];
  if (candles.length < lookback * 2 + 1) return { support, resistance };

  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i] as Candle;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      const other = candles[j] as Candle;
      if (other.high >= c.high) isHigh = false;
      if (other.low <= c.low) isLow = false;
    }
    if (isHigh) resistance.push(c.high);
    if (isLow) support.push(c.low);
  }

  const price = (candles[candles.length - 1] as Candle).close;
  // Cluster within 1.5% — below that the levels are the same line drawn twice.
  const cluster = (levels: number[]): number[] => {
    const sorted = [...levels].sort((a, b) => a - b);
    const out: number[] = [];
    for (const lv of sorted) {
      const last = out[out.length - 1];
      if (last === undefined || Math.abs(lv - last) / last > 0.015) out.push(lv);
    }
    return out;
  };

  return {
    support: cluster(support)
      .filter((l) => l < price)
      .slice(-3),
    resistance: cluster(resistance)
      .filter((l) => l > price)
      .slice(0, 3),
  };
}

/** Percentage momentum over `bars`. */
export function momentum(closes: number[], bars = 20): number | undefined {
  if (closes.length < bars + 1) return undefined;
  const now = closes[closes.length - 1] as number;
  const then = closes[closes.length - 1 - bars] as number;
  if (then === 0) return undefined;
  return ((now - then) / then) * 100;
}

/** Latest volume relative to its `period` average. 1.0 = average. */
export function volumeRatio(candles: Candle[], period = 20): number | undefined {
  if (candles.length < period + 1) return undefined;
  const window = candles.slice(-period - 1, -1);
  let sum = 0;
  for (const c of window) sum += c.volume;
  const avg = sum / window.length;
  if (avg <= 0) return undefined; // provider omitted volume
  return (candles[candles.length - 1] as Candle).volume / avg;
}

/** Annualised volatility from daily log returns. */
export function volatility(closes: number[], period = 30): number | undefined {
  if (closes.length < period + 1) return undefined;
  const returns: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    const prev = closes[i - 1] as number;
    const cur = closes[i] as number;
    if (prev > 0 && cur > 0) returns.push(Math.log(cur / prev));
  }
  if (returns.length < 2) return undefined;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/** Maximum peak-to-trough decline over the window, as a positive percentage. */
export function maxDrawdown(closes: number[]): number | undefined {
  if (closes.length < 2) return undefined;
  let peak = closes[0] as number;
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) {
      const dd = (peak - c) / peak;
      if (dd > worst) worst = dd;
    }
  }
  return worst * 100;
}
