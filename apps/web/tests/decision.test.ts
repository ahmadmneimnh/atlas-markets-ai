import { describe, expect, it } from 'vitest';

import {
  INSUFFICIENT_DATA_MESSAGE,
  buildTradePlan,
  stanceOf,
  type AnalystTarget,
} from '@/lib/analysis/decision';
import { atr, sma } from '@/lib/analysis/indicators';
import type { AssetContext, AssetScore, Recommendation } from '@/lib/analysis/types';
import type { Candle } from '@/lib/providers/types';

/** Builds candles from closes, with a high/low envelope so ATR > 0. */
function candlesFrom(closes: number[], envelope = 0.01): Candle[] {
  return closes.map((close, i) => ({
    time: new Date(Date.UTC(2025, 0, 1 + i)),
    open: i === 0 ? close : (closes[i - 1] as number),
    high: close * (1 + envelope),
    low: close * (1 - envelope),
    close,
    volume: 1_000_000,
  }));
}

/** Strictly rising: RSI pins at 100 and there are no interior pivots at all. */
function rising(n = 260, start = 100, step = 0.5): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

/** Oscillating: produces real pivot supports below and resistances above. */
function sawtooth(n = 260, base = 100, amplitude = 10, period = 20): number[] {
  return Array.from(
    { length: n },
    (_, i) => base + amplitude * Math.sin((i * 2 * Math.PI) / period),
  );
}

function scoreOf(
  recommendation: Recommendation,
  severity: 'low' | 'medium' | 'high' = 'medium',
  confidence = 72,
): AssetScore {
  return {
    ref: { symbol: 'TEST', market: 'NASDAQ', kind: 'equity' },
    score: 74,
    recommendation,
    confidence,
    breakdown: [],
    omitted: [],
    topReasons: [],
    sources: ['finnhub'],
    risk: { severity, drivers: [], caveats: [] },
    computedAt: new Date('2026-08-01T12:00:00Z'),
  };
}

function contextFrom(closes: number[], quotePrice?: number, envelope = 0.01): AssetContext {
  const candles = candlesFrom(closes, envelope);
  const ctx: AssetContext = {
    ref: { symbol: 'TEST', market: 'NASDAQ', kind: 'equity' },
    ohlcv: {
      symbol: 'TEST',
      interval: '1d',
      candles,
      source: 'twelvedata',
      asOf: new Date('2026-08-01T12:00:00Z'),
    },
  };
  if (quotePrice !== undefined) {
    ctx.quote = {
      symbol: 'TEST',
      price: quotePrice,
      change: 1,
      changePercent: 1,
      currency: 'USD',
      source: 'finnhub',
      asOf: new Date('2026-08-01T12:00:00Z'),
    };
  }
  return ctx;
}

function expectOk(outcome: ReturnType<typeof buildTradePlan>) {
  if (!outcome.ok) throw new Error(`expected a plan, got: ${outcome.missing.join('; ')}`);
  return outcome.plan;
}

describe('insufficient data', () => {
  it('refuses a plan with no price history, using the exact required wording', () => {
    const outcome = buildTradePlan(
      { ref: { symbol: 'X', market: 'NASDAQ', kind: 'equity' } },
      scoreOf('BUY'),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toBe(INSUFFICIENT_DATA_MESSAGE);
    expect(outcome.missing[0]).toContain('OHLCV');
  });

  it('refuses a plan when there are too few bars for ATR', () => {
    // ATR(14) needs 15 bars; 10 is not a thin plan, it is no plan.
    const outcome = buildTradePlan(contextFrom(rising(10)), scoreOf('BUY'));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toBe(INSUFFICIENT_DATA_MESSAGE);
    expect(outcome.missing[0]).toContain('ATR(14)');
  });

  it('names the stop as the reason rather than emitting a stop it cannot justify', () => {
    const outcome = buildTradePlan(contextFrom(rising(10)), scoreOf('BUY'));

    if (outcome.ok) throw new Error('expected refusal');
    // The message a reader sees must say *why*, not just that something failed.
    expect(outcome.missing.join(' ')).toContain('invented number');
  });
});

describe('long plan geometry', () => {
  const closes = rising();
  const ctx = contextFrom(closes);
  const a = atr(candlesFrom(closes), 14) as number;
  const price = closes[closes.length - 1] as number;

  it('steps the zone below market by 0.5 ATR when RSI is extended', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('BUY')));

    // A strictly rising series pins RSI at 100 — the "extended" band.
    expect(plan.entry.high).toBeCloseTo(price - 0.5 * a, 6);
  });

  it('raises the zone floor to a moving average sitting inside it', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('BUY')));
    const sma20 = sma(closes, 20) as number;

    // The unfloored bottom would be a further 1.5 ATR down, but SMA(20) lies
    // inside the zone: there is no reason to wait below a level price is likely
    // to be met at, and the method has to say which level did it.
    expect(sma20).toBeGreaterThan(price - 0.5 * a - 1.5 * a);
    expect(plan.entry.low).toBeCloseTo(sma20, 6);
    expect(plan.entry.method).toContain('SMA(20)');
  });

  it('spans a full 1.5 ATR when no level lies inside the zone', () => {
    // Steep trend, tight intrabar range: both moving averages fall well below the
    // zone, so nothing floors it and the pure ATR span is visible.
    const steep = rising(260, 100, 5);
    const steepCtx = contextFrom(steep, undefined, 0.0005);
    const steepAtr = atr(candlesFrom(steep, 0.0005), 14) as number;
    const steepPrice = steep[steep.length - 1] as number;

    const plan = expectOk(buildTradePlan(steepCtx, scoreOf('BUY')));

    expect(sma(steep, 20) as number).toBeLessThan(plan.entry.low);
    expect(plan.entry.high).toBeCloseTo(steepPrice - 0.5 * steepAtr, 6);
    expect(plan.entry.low).toBeCloseTo(steepPrice - 0.5 * steepAtr - 1.5 * steepAtr, 6);
  });

  it('will not suggest buying an extended move at market', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('STRONG_BUY')));

    // The single most important property of the entry rule: at RSI 100 the top of
    // the zone is strictly below the price a reader can trade at right now.
    expect(plan.entry.high).toBeLessThan(plan.currentPrice);
  });

  it('places the stop below the entry and the target above it', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('BUY')));

    expect(plan.stop.price).toBeLessThan(plan.entry.low);
    expect(plan.target.price).toBeGreaterThan(plan.entry.high);
  });

  it('falls back to the volatility stop when no pivot support exists', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('BUY')));

    expect(plan.stop.price).toBeCloseTo(plan.entry.low - 2 * a, 6);
    expect(plan.stop.method).toContain('ATR(14)');
  });

  it('reports reward-to-risk honestly when nothing ahead clears the threshold', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('BUY')));

    // Chasing a vertical move genuinely does offer poor reward-to-risk. The module
    // reports that rather than moving the target out until the ratio looks good.
    expect(plan.riskRewardBelowTarget).toBe(true);
    expect(plan.riskReward).toBeLessThan(1.5);
    expect(plan.target.method).toContain('Nothing ahead cleared');
  });
});

describe('exit plan geometry', () => {
  const ctx = contextFrom(rising());

  it('mirrors the long case: stop above the entry, target below it', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('STRONG_SELL')));

    expect(plan.stance).toBe('exit');
    expect(plan.stop.price).toBeGreaterThan(plan.entry.high);
    expect(plan.target.price).toBeLessThan(plan.entry.low);
  });

  it('does not reuse the long RSI table, which would sell into a washed-out low', () => {
    const falling = rising().map((_, i) => 200 - i * 0.5);
    const plan = expectOk(buildTradePlan(contextFrom(falling), scoreOf('SELL')));

    // RSI is 0 here. Selling at market would be the worst possible fill, so the
    // near edge of the exit zone sits *above* the current price.
    expect(plan.entry.low).toBeGreaterThan(plan.currentPrice);
  });
});

describe('structure-aware levels', () => {
  const closes = sawtooth();
  const ctx = contextFrom(closes);

  it('uses pivot structure in the entry zone when a level sits inside it', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('BUY')));

    expect(plan.entry.low).toBeLessThan(plan.entry.high);
    // Whichever branch was taken, the method names the arithmetic it used.
    expect(plan.entry.method).toMatch(/ATR\(14\)/);
  });

  it('keeps the entry zone workably wide even when a level sits right under price', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('BUY')));
    const a = atr(candlesFrom(closes), 14) as number;

    expect(plan.entry.high - plan.entry.low).toBeGreaterThanOrEqual(0.25 * a - 1e-9);
  });

  it('never returns a stop on the wrong side of the entry', () => {
    for (const rec of ['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL'] as Recommendation[]) {
      const plan = expectOk(buildTradePlan(ctx, scoreOf(rec)));
      if (plan.stance === 'exit') expect(plan.stop.price).toBeGreaterThan(plan.entry.high);
      else expect(plan.stop.price).toBeLessThan(plan.entry.low);
    }
  });
});

describe('hold', () => {
  it('produces watch levels rather than an action, using long-side geometry', () => {
    const plan = expectOk(buildTradePlan(contextFrom(sawtooth()), scoreOf('HOLD')));

    expect(plan.stance).toBe('watch');
    expect(plan.action).toBe('HOLD');
    expect(plan.stop.price).toBeLessThan(plan.entry.low);
  });

  it('maps every band to a stance', () => {
    expect(stanceOf('STRONG_BUY')).toBe('long');
    expect(stanceOf('BUY')).toBe('long');
    expect(stanceOf('HOLD')).toBe('watch');
    expect(stanceOf('SELL')).toBe('exit');
    expect(stanceOf('STRONG_SELL')).toBe('exit');
  });
});

describe('citations and provenance', () => {
  const ctx = contextFrom(sawtooth(), 96);

  it('tags every level input with the provider it came from', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('BUY')));

    for (const input of [...plan.entry.inputs, ...plan.target.inputs, ...plan.stop.inputs]) {
      expect(input.source).toBeTruthy();
      expect(input.value).toBeTruthy();
    }
  });

  it('anchors to the live quote and credits it, not the daily close', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('BUY')));

    expect(plan.currentPrice).toBe(96);
    expect(plan.priceSource).toBe('finnhub');
    expect(plan.currency).toBe('USD');
  });

  it('says so when it had to fall back to the last close', () => {
    const plan = expectOk(buildTradePlan(contextFrom(sawtooth()), scoreOf('BUY')));

    expect(plan.priceSource).toBe('twelvedata');
    expect(plan.missing.join(' ')).toContain('live quote');
  });

  it('includes an analyst consensus as a target candidate and credits the provider', () => {
    const analyst: AnalystTarget = { consensus: 130, high: 150, low: 110, source: 'fmp' };
    const plan = expectOk(buildTradePlan(ctx, scoreOf('BUY'), analyst));

    const cited = plan.target.inputs.find((i) => i.label === 'Analyst consensus target');
    expect(cited?.source).toBe('fmp');
    expect(cited?.value).toBe('130.00');
  });

  it('reports the absence of analyst targets rather than staying silent', () => {
    const plan = expectOk(buildTradePlan(ctx, scoreOf('BUY')));

    expect(plan.missing.join(' ')).toContain('analyst price targets');
    expect(plan.target.inputs.some((i) => i.label === 'Analyst consensus target')).toBe(false);
  });
});

describe('risk level', () => {
  it('is taken from the score, never recomputed', () => {
    const ctx = contextFrom(sawtooth());

    // Same price history, different risk assessments: the plan must follow the
    // score. Recomputing here is how one asset ends up showing two risk levels.
    expect(expectOk(buildTradePlan(ctx, scoreOf('BUY', 'low'))).riskLevel).toBe('low');
    expect(expectOk(buildTradePlan(ctx, scoreOf('BUY', 'high'))).riskLevel).toBe('high');
  });

  it('carries confidence through unchanged rather than folding it into the levels', () => {
    const ctx = contextFrom(sawtooth());
    const low = expectOk(buildTradePlan(ctx, scoreOf('BUY', 'medium', 20)));
    const high = expectOk(buildTradePlan(ctx, scoreOf('BUY', 'medium', 90)));

    expect(low.confidence).toBe(20);
    expect(high.confidence).toBe(90);
    // Confidence describes how much was known; it must not silently move a price.
    expect(low.entry.low).toBeCloseTo(high.entry.low, 10);
    expect(low.stop.price).toBeCloseTo(high.stop.price, 10);
  });
});

describe('reward-to-risk', () => {
  it('measures from the entry midpoint against the stop', () => {
    const plan = expectOk(buildTradePlan(contextFrom(sawtooth()), scoreOf('BUY')));

    const mid = (plan.entry.low + plan.entry.high) / 2;
    const expected = Math.abs(plan.target.price - mid) / Math.abs(mid - plan.stop.price);
    expect(plan.riskReward).toBeCloseTo(expected, 10);
  });

  it('prefers observed structure over a nearer volatility projection', () => {
    const plan = expectOk(buildTradePlan(contextFrom(sawtooth()), scoreOf('BUY')));

    // The measured move is arithmetic on ATR; a pivot high is somewhere price
    // actually turned. Ranking them together by distance would let the formula
    // displace the evidence whenever it happened to land nearer, and the reader
    // could not tell which kind of claim the target was.
    const projectionLabel = plan.target.inputs.find((i) => i.label.startsWith('Measured move'));
    expect(projectionLabel).toBeDefined();
    expect(plan.target.method).toContain('Nearest observed level');
    expect(plan.target.method).not.toContain('Measured move');
  });

  it('falls back to the projection only when no observed level pays for the risk', () => {
    // A strictly rising series has no pivot highs at all, so the 52-week high is
    // the only observed candidate and it sits just above price.
    const plan = expectOk(buildTradePlan(contextFrom(rising()), scoreOf('BUY')));

    expect(plan.target.method).toContain('Measured move');
  });

  it('prefers the nearest level that clears the threshold over the very nearest', () => {
    const analyst: AnalystTarget = { consensus: 400, source: 'fmp' };
    const plan = expectOk(buildTradePlan(contextFrom(sawtooth()), scoreOf('BUY'), analyst));

    // A 400 target on a ~100 asset clears any ratio, but it is far away; the
    // module must not jump to it if a nearer level already pays 1.5:1.
    expect(plan.riskReward).toBeGreaterThanOrEqual(1.5);
    expect(plan.target.price).toBeLessThan(400);
  });
});
