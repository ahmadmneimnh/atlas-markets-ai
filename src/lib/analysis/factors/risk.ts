import { atr, volatility, maxDrawdown, rangeStats } from '../indicators';
import type { AssetContext, FactorOutcome, FactorScorer, Signal } from '../types';

/**
 * Risk factor (nominal weight 5%).
 *
 * Scored inversely: low realized risk scores high, so it composes with the other
 * factors without special-casing in the engine. This is a risk *penalty* on the
 * recommendation, not a prediction of return.
 *
 * Computed entirely from price history, so it works for any asset with enough bars
 * regardless of which fundamentals a provider happens to expose.
 */

interface Contribution {
  weight: number;
  score: number;
  signal: Signal;
}

function band(value: number, bad: number, good: number): number {
  if (good === bad) return 50;
  return Math.max(0, Math.min(100, ((value - bad) / (good - bad)) * 100));
}

export const riskScorer: FactorScorer = {
  factor: 'risk',
  weight: 5,

  score(ctx: AssetContext): FactorOutcome {
    const series = ctx.ohlcv;
    if (!series || series.candles.length < 31) {
      return { factor: 'risk', unavailable: true, reason: 'insufficient price history for risk measures' };
    }

    const candles = series.candles;
    const closes = candles.map((c) => c.close);
    const price = closes[closes.length - 1] as number;
    const src = series.source;
    const c: Contribution[] = [];

    const vol = volatility(closes, 30);
    if (vol !== undefined) {
      // Crypto is structurally more volatile; judging it on an equity scale would
      // mark every token maximally risky and flatten the factor into a constant.
      const isCrypto = ctx.ref.kind === 'crypto';
      const score = band(vol, isCrypto ? 150 : 80, isCrypto ? 35 : 12);
      c.push({
        weight: 0.4, score,
        signal: {
          label: 'Annualised volatility (30d)',
          value: `${vol.toFixed(1)}%`,
          direction: score > 60 ? 'bullish' : score < 40 ? 'bearish' : 'neutral',
          weight: 0.4, source: src,
        },
      });
    }

    const dd = maxDrawdown(closes.slice(-252));
    if (dd !== undefined) {
      c.push({
        weight: 0.3, score: band(dd, 70, 10),
        signal: {
          label: 'Max drawdown (1y)',
          value: `${dd.toFixed(1)}%`,
          direction: dd < 20 ? 'bullish' : dd > 50 ? 'bearish' : 'neutral',
          weight: 0.3, source: src,
        },
      });
    }

    const a = atr(candles, 14);
    if (a !== undefined && price > 0) {
      // ATR as a share of price makes the measure comparable across assets.
      const atrPct = (a / price) * 100;
      c.push({
        weight: 0.2, score: band(atrPct, 12, 1),
        signal: {
          label: 'ATR(14) as % of price',
          value: `${atrPct.toFixed(2)}%`,
          direction: atrPct < 2.5 ? 'bullish' : atrPct > 7 ? 'bearish' : 'neutral',
          weight: 0.2, source: src,
        },
      });
    }

    const range = rangeStats(candles);
    if (range) {
      // Sitting at the very top of the 52-week range carries drawdown risk even
      // when momentum is favourable — this is what keeps the risk factor from
      // simply echoing the technical factor.
      const stretched = range.positionInRange > 0.95;
      c.push({
        weight: 0.1, score: stretched ? 35 : 60,
        signal: {
          label: stretched ? 'Extended at 52-week high' : 'Not extended in 52-week range',
          value: `${(range.positionInRange * 100).toFixed(0)}% of range`,
          direction: stretched ? 'bearish' : 'neutral',
          weight: 0.1, source: src,
        },
      });
    }

    if (c.length === 0) {
      return { factor: 'risk', unavailable: true, reason: 'no risk measure could be computed' };
    }

    const total = c.reduce((s, x) => s + x.weight, 0);
    return {
      factor: 'risk',
      score: c.reduce((s, x) => s + x.score * x.weight, 0) / total,
      confidence: Math.min(1, total),
      signals: c.sort((x, y) => y.weight - x.weight).map((x) => x.signal),
    };
  },
};
