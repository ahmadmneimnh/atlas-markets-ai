import type { OhlcvSeries, Quote } from '@/lib/providers/types';
import { formatNumber, formatPercent, formatPrice } from '@/lib/format';
import {
  adx, atr, bollinger, ema, macd, maCross, momentum, rangeStats, rsi, sma,
  supportResistance, trendDirection, volatility, volumeRatio, volumeTrend, maxDrawdown,
  type AdxResult, type BollingerResult, type MacdResult, type TrendResult, type VolumeTrendResult,
} from './indicators';
import {
  moduleUnavailable, reason, warning,
  type Evidence, type Metric, type ModuleResult,
} from './types';

/**
 * Technical analysis module.
 *
 * Every signal below is a measurement of the supplied price history — there is no
 * branch that produces a signal without the bars to support it. Where history is too
 * short for an indicator, that indicator contributes nothing and lowers
 * `completeness` rather than defaulting to neutral.
 */

const MIN_BARS = 30;

export interface TechnicalSnapshot {
  rsi14: number | undefined;
  macd: MacdResult | undefined;
  ema20: number | undefined;
  ema50: number | undefined;
  ema200: number | undefined;
  sma50: number | undefined;
  sma200: number | undefined;
  bollinger: BollingerResult | undefined;
  atr14: number | undefined;
  atrPercent: number | undefined;
  adx14: AdxResult | undefined;
  support: number[];
  resistance: number[];
  trend: TrendResult | undefined;
  volume: VolumeTrendResult | undefined;
  volumeRatio20: number | undefined;
  momentum20: number | undefined;
  volatility30: number | undefined;
  maxDrawdown1y: number | undefined;
  positionInRange: number | undefined;
  price: number;
  bars: number;
}

/** Computes every indicator the series can support. Pure — no I/O. */
export function snapshot(series: OhlcvSeries): TechnicalSnapshot | undefined {
  const candles = series.candles;
  if (candles.length < 2) return undefined;

  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1] as number;
  const atr14 = atr(candles, 14);
  const levels = supportResistance(candles.slice(-120));

  return {
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    bollinger: bollinger(closes, 20, 2),
    atr14,
    atrPercent: atr14 !== undefined && price > 0 ? (atr14 / price) * 100 : undefined,
    adx14: adx(candles, 14),
    support: levels.support,
    resistance: levels.resistance,
    trend: trendDirection(closes),
    volume: volumeTrend(candles),
    volumeRatio20: volumeRatio(candles, 20),
    momentum20: momentum(closes, 20),
    volatility30: volatility(closes, 30),
    maxDrawdown1y: maxDrawdown(closes.slice(-252)),
    positionInRange: rangeStats(candles)?.positionInRange,
    price,
    bars: candles.length,
  };
}

/**
 * Scores the snapshot.
 *
 * Each signal contributes a signed vote in [-1, 1] with a weight. The final score is
 * the weighted average mapped onto 0–100, so a module built from four available
 * signals is on the same scale as one built from nine — only its `completeness`
 * differs.
 */
export function analyseTechnical(
  series: OhlcvSeries | null,
  unavailableReason?: { reason: Parameters<typeof moduleUnavailable>[2]; detail?: string },
): ModuleResult {
  const label = 'Technical';

  if (!series) {
    return moduleUnavailable(
      'technical',
      label,
      unavailableReason?.reason ?? 'no_provider_configured',
      unavailableReason?.detail ?? 'no price history provider is configured for this asset',
    );
  }
  if (series.candles.length < MIN_BARS) {
    return moduleUnavailable(
      'technical',
      label,
      'not_supported',
      `only ${series.candles.length} daily bars available; ${MIN_BARS} are needed before indicators mean anything`,
    );
  }

  const s = snapshot(series);
  if (!s) return moduleUnavailable('technical', label, 'not_found', 'price history was empty');

  const votes: { weight: number; vote: number }[] = [];
  const evidence: Evidence[] = [];
  const add = (weight: number, vote: number) => votes.push({ weight, vote: clamp(vote, -1, 1) });

  // Trend structure — the heaviest single input: everything else reads differently
  // in an uptrend than in a downtrend.
  if (s.trend) {
    const map: Record<TrendResult['direction'], number> = {
      strong_uptrend: 1, uptrend: 0.5, sideways: 0, downtrend: -0.5, strong_downtrend: -1,
    };
    add(3, map[s.trend.direction]);
    const dir = map[s.trend.direction];
    if (dir > 0) {
      evidence.push(reason('technical', `Trend is a ${label2(s.trend.direction)} (${s.trend.basis})`, 'bullish', dir === 1 ? 'high' : 'medium'));
    } else if (dir < 0) {
      evidence.push(warning('technical', `Trend is a ${label2(s.trend.direction)} (${s.trend.basis})`, dir === -1 ? 'high' : 'medium'));
    } else {
      evidence.push(reason('technical', `Trend is sideways (${s.trend.basis})`, 'neutral', 'low'));
    }
  }

  // Price against the 200-day: the single most-cited regime line.
  if (s.ema200 !== undefined) {
    const above = s.price > s.ema200;
    const distance = ((s.price - s.ema200) / s.ema200) * 100;
    add(2, above ? 0.7 : -0.7);
    evidence.push(
      above
        ? reason('technical', `Trading ${formatPercent(distance)} above the 200-day EMA (${formatPrice(s.ema200)})`, 'bullish', 'high')
        : warning('technical', `Trading ${formatPercent(distance)} below the 200-day EMA (${formatPrice(s.ema200)})`, 'high'),
    );
  }

  // RSI: the extremes are the informative part, the middle is not.
  if (s.rsi14 !== undefined) {
    const r = s.rsi14;
    if (r < 30) {
      add(2, 0.6);
      evidence.push(reason('technical', `RSI(14) at ${formatNumber(r, 1)} — oversold, historically a mean-reversion zone`, 'bullish', 'medium'));
    } else if (r < 45) {
      add(2, 0.25);
      evidence.push(reason('technical', `RSI(14) at ${formatNumber(r, 1)} — recovering from the lower half of the range`, 'bullish', 'low'));
    } else if (r > 70) {
      add(2, -0.5);
      evidence.push(warning('technical', `RSI(14) at ${formatNumber(r, 1)} — overbought; entries here carry poor reward-to-risk`, 'medium'));
    } else if (r > 55) {
      add(2, 0.3);
      evidence.push(reason('technical', `RSI(14) at ${formatNumber(r, 1)} — momentum in the bullish half without being stretched`, 'bullish', 'low'));
    } else {
      add(2, 0);
    }
  }

  // MACD: a fresh crossover is news; sign alone is a slower confirmation.
  if (s.macd) {
    const m = s.macd;
    if (m.crossover === 'bullish') {
      add(2, 0.9);
      evidence.push(reason('technical', `MACD bullish crossover on the latest bar (histogram ${formatNumber(m.histogram, 3)})`, 'bullish', 'high'));
    } else if (m.crossover === 'bearish') {
      add(2, -0.9);
      evidence.push(warning('technical', `MACD bearish crossover on the latest bar (histogram ${formatNumber(m.histogram, 3)})`, 'high'));
    } else {
      add(2, m.histogram > 0 ? 0.4 : -0.4);
      evidence.push(
        m.histogram > 0
          ? reason('technical', `MACD holding above its signal line (histogram ${formatNumber(m.histogram, 3)})`, 'bullish', 'low')
          : warning('technical', `MACD below its signal line (histogram ${formatNumber(m.histogram, 3)})`, 'low'),
      );
    }
  }

  // ADX measures conviction, not direction — it amplifies the DI spread.
  if (s.adx14) {
    const { adx: strength, plusDi, minusDi } = s.adx14;
    const directional = plusDi > minusDi ? 1 : -1;
    if (strength >= 25) {
      add(1.5, directional * 0.8);
      evidence.push(
        directional > 0
          ? reason('technical', `ADX at ${formatNumber(strength, 1)} with +DI above −DI — a trending market, not a drift`, 'bullish', 'medium')
          : warning('technical', `ADX at ${formatNumber(strength, 1)} with −DI above +DI — a committed downtrend`, 'medium'),
      );
    } else {
      add(1.5, 0);
      evidence.push(reason('technical', `ADX at ${formatNumber(strength, 1)} — no trend strong enough to follow`, 'neutral', 'low'));
    }
  }

  // Bollinger position, read with the trend rather than as a standalone signal.
  if (s.bollinger) {
    const b = s.bollinger;
    if (b.percentB < 0) {
      add(1, 0.5);
      evidence.push(reason('technical', `Price closed below the lower Bollinger band (${formatPrice(b.lower)}) — a stretched move`, 'bullish', 'low'));
    } else if (b.percentB > 1) {
      add(1, -0.5);
      evidence.push(warning('technical', `Price closed above the upper Bollinger band (${formatPrice(b.upper)}) — extended`, 'low'));
    } else {
      add(1, (b.percentB - 0.5) * 0.6);
    }
  }

  // 20-day momentum.
  if (s.momentum20 !== undefined) {
    const m = s.momentum20;
    add(1.5, clamp(m / 20, -1, 1));
    if (Math.abs(m) >= 5) {
      evidence.push(
        m > 0
          ? reason('technical', `Up ${formatPercent(m)} over the last 20 sessions`, 'bullish', 'medium')
          : warning('technical', `Down ${formatPercent(m)} over the last 20 sessions`, 'medium'),
      );
    }
  }

  // Volume confirmation. Absent volume is not weak volume — it is skipped.
  if (s.volume) {
    const v = s.volume;
    const priceRising = (s.momentum20 ?? 0) > 0;
    if (v.direction === 'rising') {
      add(1, priceRising ? 0.6 : -0.3);
      evidence.push(
        priceRising
          ? reason('technical', `Volume up ${formatPercent((v.ratio - 1) * 100)} against its 20-day base while price rose — participation is confirming`, 'bullish', 'medium')
          : warning('technical', `Volume up ${formatPercent((v.ratio - 1) * 100)} on a falling price — distribution`, 'medium'),
      );
    } else if (v.direction === 'falling') {
      add(1, priceRising ? -0.4 : 0.1);
      if (priceRising) {
        evidence.push(warning('technical', `Volume down ${formatPercent((1 - v.ratio) * 100)} against its 20-day base while price rose — the move is thinly supported`, 'medium'));
      }
    } else {
      add(1, 0);
    }
  }

  // Golden / death cross, only on the bar it happens.
  const cross = maCross(series.candles.map((c) => c.close));
  if (cross === 'golden') {
    add(1.5, 0.9);
    evidence.push(reason('technical', 'Golden cross: the 50-day SMA crossed above the 200-day on this bar', 'bullish', 'high'));
  } else if (cross === 'death') {
    add(1.5, -0.9);
    evidence.push(warning('technical', 'Death cross: the 50-day SMA crossed below the 200-day on this bar', 'high'));
  }

  // Position within the 52-week range: the tails matter, the middle does not.
  if (s.positionInRange !== undefined) {
    const p = s.positionInRange;
    if (p > 0.95) {
      add(1, 0.3);
      evidence.push(reason('technical', 'Trading within 5% of its 52-week high', 'bullish', 'low'));
    } else if (p < 0.05) {
      add(1, -0.3);
      evidence.push(warning('technical', 'Trading within 5% of its 52-week low', 'low'));
    } else {
      add(1, (p - 0.5) * 0.4);
    }
  }

  if (s.support.length > 0) {
    evidence.push(reason('technical', `Nearest support at ${formatPrice(s.support[s.support.length - 1] as number)}, from 120-day pivot lows`, 'neutral', 'low'));
  }
  if (s.resistance.length > 0) {
    evidence.push(reason('technical', `Nearest resistance at ${formatPrice(s.resistance[0] as number)}, from 120-day pivot highs`, 'neutral', 'low'));
  }

  const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
  const weighted = totalWeight === 0 ? 0 : votes.reduce((sum, v) => sum + v.weight * v.vote, 0) / totalWeight;
  const score = clamp(50 + weighted * 50, 0, 100);

  // Completeness is measured against the indicators a full year of bars supports.
  const possible = [
    s.rsi14, s.macd, s.ema20, s.ema50, s.ema200, s.bollinger,
    s.atr14, s.adx14, s.volume, s.momentum20, s.positionInRange,
  ];
  const completeness = possible.filter((v) => v !== undefined).length / possible.length;

  return {
    id: 'technical',
    label,
    available: true,
    score,
    completeness,
    evidence,
    metrics: metricsFor(s),
    sources: [series.source],
  };
}

function metricsFor(s: TechnicalSnapshot): Metric[] {
  const num = (v: number | undefined, digits = 2) => (v === undefined ? null : formatNumber(v, digits));
  const px = (v: number | undefined) => (v === undefined ? null : formatPrice(v));

  return [
    { label: 'RSI (14)', value: num(s.rsi14, 1), hint: 'Below 30 oversold, above 70 overbought', direction: s.rsi14 === undefined ? 'neutral' : s.rsi14 > 70 ? 'bearish' : s.rsi14 < 30 ? 'bullish' : 'neutral' },
    { label: 'MACD histogram', value: num(s.macd?.histogram, 3), hint: s.macd?.crossover ? `${s.macd.crossover} crossover on the latest bar` : 'No crossover on the latest bar', direction: s.macd === undefined ? 'neutral' : s.macd.histogram > 0 ? 'bullish' : 'bearish' },
    { label: 'EMA 20', value: px(s.ema20) },
    { label: 'EMA 50', value: px(s.ema50) },
    { label: 'EMA 200', value: px(s.ema200) },
    { label: 'SMA 50 / 200', value: s.sma50 === undefined || s.sma200 === undefined ? null : `${formatPrice(s.sma50)} / ${formatPrice(s.sma200)}` },
    { label: 'Bollinger %B', value: num(s.bollinger?.percentB, 2), hint: '0 = lower band, 1 = upper band' },
    { label: 'ATR (14)', value: s.atr14 === undefined ? null : `${formatPrice(s.atr14)}${s.atrPercent !== undefined ? ` (${formatNumber(s.atrPercent, 1)}%)` : ''}`, hint: 'Average daily true range' },
    { label: 'ADX (14)', value: num(s.adx14?.adx, 1), hint: 'Above 25 indicates a trending market' },
    { label: 'Support', value: s.support.length ? s.support.slice().reverse().map(formatPrice).join(' · ') : null, hint: '120-day pivot lows below price' },
    { label: 'Resistance', value: s.resistance.length ? s.resistance.map(formatPrice).join(' · ') : null, hint: '120-day pivot highs above price' },
    { label: 'Trend', value: s.trend ? label2(s.trend.direction) : null, hint: s.trend?.basis },
    { label: 'Volume trend', value: s.volume ? `${s.volume.direction} (${formatNumber(s.volume.ratio, 2)}× base)` : null, hint: s.volume ? '5-day average against the prior 20' : 'Provider reports no volume for this series' },
    { label: '20-day momentum', value: s.momentum20 === undefined ? null : formatPercent(s.momentum20), direction: (s.momentum20 ?? 0) > 0 ? 'bullish' : 'bearish' },
  ];
}

/** Quote-only sanity check: the analysis price should be the traded price. */
export function priceDrift(quote: Quote, series: OhlcvSeries): number | undefined {
  const last = series.candles[series.candles.length - 1]?.close;
  if (last === undefined || last === 0) return undefined;
  return ((quote.price - last) / last) * 100;
}

function label2(t: TrendResult['direction']): string {
  return t.replace('_', ' ');
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
