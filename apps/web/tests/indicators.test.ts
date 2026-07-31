import { describe, it, expect } from 'vitest';
import {
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  atr,
  adx,
  vwap,
  ichimoku,
  rangeStats,
  maCross,
  supportResistance,
  momentum,
  volumeRatio,
  volatility,
  maxDrawdown,
} from '@/lib/analysis/indicators';
import type { Candle } from '@/lib/providers/types';

/** Builds candles from closes, deriving a plausible high/low around each close. */
function candles(closes: number[], volumes?: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: new Date(2024, 0, i + 1),
    open: i === 0 ? c : (closes[i - 1] as number),
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: volumes?.[i] ?? 1_000,
  }));
}

describe('sma / ema', () => {
  it('averages the trailing window', () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 2)).toBe(4.5);
  });

  it('returns undefined rather than a partial average when history is short', () => {
    expect(sma([1, 2], 5)).toBeUndefined();
    expect(ema([1, 2], 5)).toBeUndefined();
  });

  it('seeds EMA with the SMA of the first period', () => {
    // First EMA value equals SMA(1..5) = 3; then 6*k + 3*(1-k), k = 2/6 = 0.3333
    const result = ema([1, 2, 3, 4, 5, 6], 5);
    expect(result).toBeCloseTo(3 + (6 - 3) * (2 / 6), 6);
  });

  it('converges to SMA on a linear ramp', () => {
    // On a constant-increment series both averages lag the last value by
    // d*(period-1)/2, so they coincide exactly. This pins the EMA seeding: a
    // seed other than SMA(first period) would leave a permanent offset here.
    const rising = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(ema(rising, 5)!).toBeCloseTo(sma(rising, 5)!, 10);
  });

  it('leads SMA on an accelerating series', () => {
    // Convex growth is where the recency weighting actually shows up.
    const accelerating = Array.from({ length: 20 }, (_, i) => i ** 2);
    expect(ema(accelerating, 5)!).toBeGreaterThan(sma(accelerating, 5)!);
  });
});

describe('rsi', () => {
  /**
   * The canonical RSI(14) worked example (Wilder / StockCharts). 15 closes give
   * exactly 14 changes, so this pins the seed average before any smoothing:
   * gains 3.34, losses 1.40 → RS = 2.3857 → RSI = 70.46.
   */
  const wilder = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
    46.28,
  ];

  it('matches the published worked example', () => {
    expect(rsi(wilder, 14)).toBeCloseTo(70.46, 2);
  });

  it('returns 100 when the window has no down-closes', () => {
    expect(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14)).toBe(100);
  });

  it('returns 50 for a completely flat series rather than dividing by zero', () => {
    expect(rsi(new Array(20).fill(100), 14)).toBe(50);
  });

  it('is undefined below period + 1 samples', () => {
    expect(rsi([1, 2, 3], 14)).toBeUndefined();
  });

  it('stays within bounds on noisy data', () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    const v = rsi(noisy, 14)!;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });
});

describe('macd', () => {
  it('is positive when the fast EMA leads on a rising series', () => {
    const rising = Array.from({ length: 100 }, (_, i) => 100 + i);
    const r = macd(rising)!;
    expect(r).toBeDefined();
    expect(r.macd).toBeGreaterThan(0);
    expect(r.macd - r.signal).toBeCloseTo(r.histogram, 10);
  });

  it('is negative on a falling series', () => {
    const falling = Array.from({ length: 100 }, (_, i) => 200 - i);
    expect(macd(falling)!.macd).toBeLessThan(0);
  });

  it('flags a bullish crossover when a downtrend reverses', () => {
    // Long decline, then a sharp recovery that drags the histogram through zero.
    const series = [
      ...Array.from({ length: 60 }, (_, i) => 200 - i * 1.5),
      ...Array.from({ length: 30 }, (_, i) => 110 + i * 4),
    ];
    const r = macd(series)!;
    expect(r.histogram).toBeGreaterThan(0);
  });

  it('requires enough history for the signal line', () => {
    expect(macd(Array.from({ length: 20 }, (_, i) => i))).toBeUndefined();
  });
});

describe('bollinger', () => {
  it('collapses to the mean when the series is flat', () => {
    const r = bollinger(new Array(30).fill(50), 20)!;
    expect(r.middle).toBe(50);
    expect(r.upper).toBe(50);
    expect(r.lower).toBe(50);
    expect(r.percentB).toBe(0.5); // guarded against 0/0
  });

  it('places percentB above 1 when price breaches the upper band', () => {
    const series = [...new Array(20).fill(100), 200];
    const r = bollinger(series, 20)!;
    expect(r.percentB).toBeGreaterThan(1);
  });

  it('brackets the middle band', () => {
    const noisy = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 5);
    const r = bollinger(noisy, 20)!;
    expect(r.upper).toBeGreaterThan(r.middle);
    expect(r.lower).toBeLessThan(r.middle);
  });
});

describe('atr / adx', () => {
  it('computes a positive ATR on a volatile series', () => {
    const c = candles(Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 10));
    expect(atr(c, 14)!).toBeGreaterThan(0);
  });

  it('reports a strong trend with +DI dominant on a steady climb', () => {
    const c = candles(Array.from({ length: 100 }, (_, i) => 100 + i * 2));
    const r = adx(c, 14)!;
    expect(r).toBeDefined();
    expect(r.plusDi).toBeGreaterThan(r.minusDi);
    expect(r.adx).toBeGreaterThan(20);
  });

  it('reports -DI dominant on a steady decline', () => {
    const c = candles(Array.from({ length: 100 }, (_, i) => 300 - i * 2));
    const r = adx(c, 14)!;
    expect(r.minusDi).toBeGreaterThan(r.plusDi);
  });

  it('needs 2x period of history', () => {
    expect(adx(candles([1, 2, 3, 4, 5]), 14)).toBeUndefined();
  });
});

describe('vwap', () => {
  it('weights toward the high-volume bar', () => {
    const c = candles([10, 20], [1, 999]);
    // Heavily weighted to the second bar's typical price (~20).
    expect(vwap(c)!).toBeGreaterThan(19);
  });

  it('returns undefined when the provider omitted volume', () => {
    // CoinGecko's /ohlc endpoint returns no volume; VWAP must not degrade into a
    // plain average presented under the VWAP label.
    expect(vwap(candles([10, 20, 30], [0, 0, 0]))).toBeUndefined();
  });
});

describe('ichimoku', () => {
  it('puts price above the cloud in a sustained uptrend', () => {
    const c = candles(Array.from({ length: 80 }, (_, i) => 100 + i * 3));
    expect(ichimoku(c)!.position).toBe('above');
  });

  it('puts price below the cloud in a sustained downtrend', () => {
    const c = candles(Array.from({ length: 80 }, (_, i) => 400 - i * 3));
    expect(ichimoku(c)!.position).toBe('below');
  });

  it('needs 52 bars', () => {
    expect(ichimoku(candles(Array.from({ length: 30 }, () => 100)))).toBeUndefined();
  });
});

describe('structure', () => {
  it('locates the position within the 52-week range', () => {
    const c = candles([...Array.from({ length: 100 }, (_, i) => 100 + i)]);
    const r = rangeStats(c)!;
    expect(r.positionInRange).toBeGreaterThan(0.9); // at the top of its range
    expect(r.high52w).toBeGreaterThanOrEqual(r.low52w);
  });

  it('detects a golden cross only on the bar it occurs', () => {
    // 200 flat bars, then a rally strong enough to pull SMA50 through SMA200.
    const flat = new Array(220).fill(100);
    const rally = Array.from({ length: 60 }, (_, i) => 100 + i * 5);
    const series = [...flat, ...rally];

    // Scan every window long enough to have both SMAs. SMA50 crosses SMA200
    // early in the rally, so the scan must start at the first computable bar.
    let crosses = 0;
    for (let i = 201; i <= series.length; i++) {
      if (maCross(series.slice(0, i)) === 'golden') crosses++;
    }
    expect(crosses).toBe(1);
  });

  it('returns null when there is insufficient history for a 200 SMA', () => {
    expect(maCross(new Array(100).fill(100))).toBeNull();
  });

  it('finds support below and resistance above the current price', () => {
    const zigzag = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 2) * 15);
    const { support, resistance } = supportResistance(candles(zigzag));
    const price = zigzag[zigzag.length - 1] as number;
    for (const s of support) expect(s).toBeLessThan(price);
    for (const r of resistance) expect(r).toBeGreaterThan(price);
  });
});

describe('risk measures', () => {
  it('computes momentum as a percentage change', () => {
    const series = [...new Array(21).fill(100)];
    series[series.length - 1] = 110;
    expect(momentum(series, 20)).toBeCloseTo(10, 6);
  });

  it('flags a volume spike', () => {
    const c = candles(new Array(30).fill(100), [...new Array(29).fill(1_000), 5_000]);
    expect(volumeRatio(c, 20)!).toBeCloseTo(5, 1);
  });

  it('returns undefined volume ratio when volume is absent', () => {
    expect(
      volumeRatio(candles(new Array(30).fill(100), new Array(30).fill(0)), 20),
    ).toBeUndefined();
  });

  it('reports zero volatility for a flat series', () => {
    expect(volatility(new Array(50).fill(100), 30)).toBeCloseTo(0, 6);
  });

  it('measures peak-to-trough drawdown', () => {
    expect(maxDrawdown([100, 120, 60, 90])).toBeCloseTo(50, 6); // 120 → 60
  });

  it('reports no drawdown on a monotonic climb', () => {
    expect(maxDrawdown([10, 20, 30, 40])).toBe(0);
  });
});
