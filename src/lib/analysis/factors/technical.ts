import {
  rsi, macd, bollinger, adx, ichimoku, vwap, rangeStats, maCross,
  momentum, volumeRatio, sma,
} from '../indicators';
import type { AssetContext, FactorOutcome, FactorScorer, Signal } from '../types';

/**
 * Technical factor (nominal weight 30%).
 *
 * Each indicator contributes a sub-score in 0–100 and a weight. The factor score is
 * the weighted mean of whichever indicators could actually be computed — an
 * indicator with insufficient history is dropped, not defaulted. Confidence is the
 * share of the intended weight that was satisfied, so a 40-bar series scores with
 * visibly lower confidence than a 300-bar one.
 */

interface Contribution {
  weight: number;
  score: number;
  signal: Signal;
}

const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;

export const technicalScorer: FactorScorer = {
  factor: 'technical',
  weight: 30,

  score(ctx: AssetContext): FactorOutcome {
    const series = ctx.ohlcv;
    if (!series || series.candles.length < 30) {
      return {
        factor: 'technical',
        unavailable: true,
        reason: series
          ? `only ${series.candles.length} bars available; 30 required`
          : 'no price history available',
      };
    }

    const candles = series.candles;
    const closes = candles.map((c) => c.close);
    const price = closes[closes.length - 1] as number;
    const src = series.source;
    const contributions: Contribution[] = [];

    // ── RSI: mean-reversion read ────────────────────────────────────────────
    const r = rsi(closes, 14);
    if (r !== undefined) {
      // Oversold is bullish, overbought bearish. Linear map inverted around 50.
      const score = Math.max(0, Math.min(100, 100 - r));
      contributions.push({
        weight: 0.18,
        score,
        signal: {
          label: 'RSI(14)',
          value: r.toFixed(1),
          direction: r < 30 ? 'bullish' : r > 70 ? 'bearish' : 'neutral',
          weight: 0.18,
          source: src,
        },
      });
    }

    // ── MACD: trend momentum ────────────────────────────────────────────────
    const m = macd(closes);
    if (m) {
      // Normalize the histogram against price so the scale is comparable across
      // a $3 coin and a $3,000 stock.
      const normalized = price > 0 ? (m.histogram / price) * 100 : 0;
      const score = 50 + Math.max(-50, Math.min(50, normalized * 25));
      contributions.push({
        weight: 0.18,
        score,
        signal: {
          label: m.crossover ? `MACD ${m.crossover} crossover` : 'MACD histogram',
          value: m.histogram.toFixed(4),
          direction: m.histogram > 0 ? 'bullish' : m.histogram < 0 ? 'bearish' : 'neutral',
          weight: 0.18,
          source: src,
        },
      });
    }

    // ── Trend structure: price vs 50/200 SMA ────────────────────────────────
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    if (sma50 !== undefined) {
      const above50 = price > sma50;
      let score = above50 ? 65 : 35;
      let label = `Price ${above50 ? 'above' : 'below'} SMA(50)`;

      if (sma200 !== undefined) {
        const above200 = price > sma200;
        // Both above is a clean uptrend; both below a clean downtrend.
        score = above50 && above200 ? 80 : !above50 && !above200 ? 20 : 50;
        label = `Price vs SMA(50)/SMA(200)`;
      }

      contributions.push({
        weight: 0.16,
        score,
        signal: {
          label,
          value: sma200 !== undefined
            ? `${price.toFixed(2)} / ${sma50.toFixed(2)} / ${sma200.toFixed(2)}`
            : `${price.toFixed(2)} / ${sma50.toFixed(2)}`,
          direction: score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral',
          weight: 0.16,
          source: src,
        },
      });
    }

    // ── Golden / death cross ────────────────────────────────────────────────
    const cross = maCross(closes);
    if (cross) {
      contributions.push({
        weight: 0.1,
        score: cross === 'golden' ? 88 : 12,
        signal: {
          label: cross === 'golden' ? 'Golden cross (SMA50 × SMA200)' : 'Death cross (SMA50 × SMA200)',
          value: 'today',
          direction: cross === 'golden' ? 'bullish' : 'bearish',
          weight: 0.1,
          source: src,
        },
      });
    }

    // ── ADX: trend strength, directional ────────────────────────────────────
    const a = adx(candles, 14);
    if (a) {
      // ADX itself is non-directional; direction comes from DI dominance, and the
      // magnitude of the tilt scales with trend strength.
      const strength = Math.min(1, a.adx / 50);
      const directional = a.plusDi >= a.minusDi ? 1 : -1;
      contributions.push({
        weight: 0.12,
        score: 50 + directional * strength * 35,
        signal: {
          label: `ADX(14) ${a.adx > 25 ? 'trending' : 'ranging'}`,
          value: `${a.adx.toFixed(1)} (+DI ${a.plusDi.toFixed(1)} / -DI ${a.minusDi.toFixed(1)})`,
          direction: a.adx < 20 ? 'neutral' : directional > 0 ? 'bullish' : 'bearish',
          weight: 0.12,
          source: src,
        },
      });
    }

    // ── Bollinger position ──────────────────────────────────────────────────
    const b = bollinger(closes, 20);
    if (b) {
      // Below the lower band (percentB < 0) is a stretched-oversold condition.
      const score = Math.max(0, Math.min(100, 100 - b.percentB * 100));
      contributions.push({
        weight: 0.1,
        score,
        signal: {
          label: 'Bollinger %B',
          value: b.percentB.toFixed(2),
          direction: b.percentB < 0.2 ? 'bullish' : b.percentB > 0.8 ? 'bearish' : 'neutral',
          weight: 0.1,
          source: src,
        },
      });
    }

    // ── Ichimoku cloud ──────────────────────────────────────────────────────
    const ich = ichimoku(candles);
    if (ich) {
      const score = ich.position === 'above' ? 78 : ich.position === 'below' ? 22 : 50;
      contributions.push({
        weight: 0.08,
        score,
        signal: {
          label: `Ichimoku: price ${ich.position} cloud`,
          value: `tenkan ${ich.tenkan.toFixed(2)} / kijun ${ich.kijun.toFixed(2)}`,
          direction: ich.position === 'above' ? 'bullish' : ich.position === 'below' ? 'bearish' : 'neutral',
          weight: 0.08,
          source: src,
        },
      });
    }

    // ── 52-week range position ──────────────────────────────────────────────
    const range = rangeStats(candles);
    if (range) {
      // Near the highs indicates strength; this deliberately opposes the RSI
      // mean-reversion read, and the two are meant to net out.
      contributions.push({
        weight: 0.08,
        score: 25 + range.positionInRange * 50,
        signal: {
          label: '52-week range position',
          value: `${(range.positionInRange * 100).toFixed(0)}% of range (${range.low52w.toFixed(2)}–${range.high52w.toFixed(2)})`,
          direction: range.positionInRange > 0.75 ? 'bullish' : range.positionInRange < 0.25 ? 'bearish' : 'neutral',
          weight: 0.08,
          source: src,
        },
      });
    }

    // ── Momentum ────────────────────────────────────────────────────────────
    const mom = momentum(closes, 20);
    if (mom !== undefined) {
      contributions.push({
        weight: 0.1,
        score: 50 + Math.max(-40, Math.min(40, mom * 1.5)),
        signal: {
          label: '20-bar momentum',
          value: pct(mom),
          direction: mom > 2 ? 'bullish' : mom < -2 ? 'bearish' : 'neutral',
          weight: 0.1,
          source: src,
        },
      });
    }

    // ── Volume confirmation (skipped when the provider omits volume) ────────
    const vr = volumeRatio(candles, 20);
    if (vr !== undefined) {
      const rising = (mom ?? 0) > 0;
      // A volume spike amplifies whatever direction price is already moving.
      const score = vr > 1.5 ? (rising ? 75 : 25) : 50;
      contributions.push({
        weight: 0.06,
        score,
        signal: {
          label: 'Volume vs 20-bar average',
          value: `${vr.toFixed(2)}×`,
          direction: vr > 1.5 ? (rising ? 'bullish' : 'bearish') : 'neutral',
          weight: 0.06,
          source: src,
        },
      });
    }

    // ── VWAP ────────────────────────────────────────────────────────────────
    const vw = vwap(candles.slice(-20));
    if (vw !== undefined && vw > 0) {
      const above = price > vw;
      contributions.push({
        weight: 0.04,
        score: above ? 62 : 38,
        signal: {
          label: `Price ${above ? 'above' : 'below'} 20-bar VWAP`,
          value: vw.toFixed(2),
          direction: above ? 'bullish' : 'bearish',
          weight: 0.04,
          source: src,
        },
      });
    }

    if (contributions.length === 0) {
      return { factor: 'technical', unavailable: true, reason: 'no indicator had sufficient history' };
    }

    const totalWeight = contributions.reduce((s, c) => s + c.weight, 0);
    const weighted = contributions.reduce((s, c) => s + c.score * c.weight, 0);

    return {
      factor: 'technical',
      score: weighted / totalWeight,
      // Total intended weight is ~1.2 when every indicator computes; confidence is
      // the fraction actually satisfied, capped at 1.
      confidence: Math.min(1, totalWeight / 1.1),
      signals: contributions
        .sort((x, y) => y.weight - x.weight)
        .map((c) => c.signal),
    };
  },
};
