import { describe, it, expect } from 'vitest';
import type { Candle, CryptoMetrics, Fundamentals, NewsArticle, OhlcvSeries } from '@/lib/providers/types';
import { analyseTechnical, snapshot } from '@/lib/analysis/technical';
import { analyseCryptoFundamentals, analyseEquityFundamentals } from '@/lib/analysis/fundamental';
import { analyseSentiment, scoreArticle } from '@/lib/analysis/sentiment';
import { classifyRisk } from '@/lib/analysis/risk';
import { deriveLevels } from '@/lib/analysis/levels';
import { trendDirection, volumeTrend } from '@/lib/analysis/indicators';

/**
 * Module-level tests. The synthetic series here are inputs to pure functions — the
 * point is to pin behaviour that must hold for any real series, especially the
 * refusals: too little history, absent fields, and news that says nothing.
 */

const day = 24 * 60 * 60 * 1000;

/** Builds a series with a controllable drift and daily wobble. */
function series(bars: number, start: number, driftPercent: number, volume = 1_000_000): OhlcvSeries {
  const candles: Candle[] = [];
  let price = start;
  for (let i = 0; i < bars; i++) {
    const wobble = Math.sin(i / 4) * 0.004;
    price = price * (1 + driftPercent / 100 + wobble);
    candles.push({
      time: new Date(Date.now() - (bars - i) * day),
      open: price * 0.997,
      high: price * 1.012,
      low: price * 0.988,
      close: price,
      volume,
    });
  }
  return { symbol: 'TEST', interval: '1d', candles, source: 'test-provider', asOf: new Date() };
}

describe('technical module', () => {
  it('refuses to analyse a series too short for its indicators', () => {
    const result = analyseTechnical(series(12, 100, 0.5));
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.unavailable.detail).toContain('12 daily bars');
  });

  it('reports unavailable, with the provider reason, when there is no series at all', () => {
    const result = analyseTechnical(null, { reason: 'rate_limited', detail: 'free plan exhausted' });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.unavailable.reason).toBe('rate_limited');
    expect(result.unavailable.detail).toBe('free plan exhausted');
  });

  it('scores a sustained uptrend above a sustained downtrend', () => {
    const up = analyseTechnical(series(300, 100, 0.35));
    const down = analyseTechnical(series(300, 100, -0.35));
    expect(up.available && down.available).toBe(true);
    if (!up.available || !down.available) return;

    expect(up.score).toBeGreaterThan(60);
    expect(down.score).toBeLessThan(40);
  });

  it('cites measured values in its evidence rather than asserting a mood', () => {
    const result = analyseTechnical(series(300, 100, 0.35));
    expect(result.available).toBe(true);
    if (!result.available) return;

    // Every reason should carry a number: this is the difference between an
    // explanation and a slogan.
    const withNumbers = result.evidence.filter((e) => /\d/.test(e.text));
    expect(withNumbers.length).toBe(result.evidence.length);
    expect(result.evidence.some((e) => e.text.includes('EMA200') || e.text.includes('200-day'))).toBe(true);
  });

  it('lowers completeness when the history cannot support every indicator', () => {
    const short = analyseTechnical(series(60, 100, 0.2));
    const long = analyseTechnical(series(320, 100, 0.2));
    expect(short.available && long.available).toBe(true);
    if (!short.available || !long.available) return;
    expect(short.completeness).toBeLessThan(long.completeness);
  });

  it('skips volume signals entirely when the provider reports no volume', () => {
    const noVolume = series(200, 100, 0.2, 0);
    const snap = snapshot(noVolume);
    expect(snap?.volume).toBeUndefined();
    expect(volumeTrend(noVolume.candles)).toBeUndefined();

    const result = analyseTechnical(noVolume);
    expect(result.available).toBe(true);
    if (!result.available) return;
    // No evidence line may claim anything about volume.
    expect(result.evidence.some((e) => e.text.toLowerCase().includes('volume'))).toBe(false);
    expect(result.metrics.find((m) => m.label === 'Volume trend')?.value).toBeNull();
  });

  it('classifies trend from moving-average stacking, not a single crossing', () => {
    const up = trendDirection(series(300, 100, 0.4).candles.map((c) => c.close));
    expect(up?.direction).toBe('strong_uptrend');
    expect(up?.basis).toContain('EMA50');

    const down = trendDirection(series(300, 100, -0.4).candles.map((c) => c.close));
    expect(down?.direction).toBe('strong_downtrend');
  });
});

describe('equity fundamentals module', () => {
  const base: Fundamentals = { symbol: 'TEST', source: 'finnhub', asOf: new Date() };

  it('does not treat a negative P/E as cheap', () => {
    const lossMaker = analyseEquityFundamentals({ ...base, peRatio: -12, profitMargin: -8 });
    const profitable = analyseEquityFundamentals({ ...base, peRatio: 12, profitMargin: 18 });
    expect(lossMaker.available && profitable.available).toBe(true);
    if (!lossMaker.available || !profitable.available) return;

    expect(lossMaker.score).toBeLessThan(profitable.score);
    expect(lossMaker.evidence.some((e) => e.text.includes('not profitable'))).toBe(true);
  });

  it('flags a stretched valuation as a warning while still scoring the growth', () => {
    const result = analyseEquityFundamentals({
      ...base, peRatio: 80, revenueGrowthYoY: 35, profitMargin: 22, freeCashFlow: 5e9,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.evidence.some((e) => e.kind === 'warning' && e.text.includes('High valuation'))).toBe(true);
    expect(result.evidence.some((e) => e.kind === 'reason' && e.text.includes('Revenue growing'))).toBe(true);
  });

  it('lowers completeness when the provider returned few fields', () => {
    const sparse = analyseEquityFundamentals({ ...base, peRatio: 20 });
    const rich = analyseEquityFundamentals({
      ...base, peRatio: 20, pegRatio: 1.4, eps: 6.1, revenueGrowthYoY: 12, earningsGrowthYoY: 9,
      profitMargin: 21, roe: 30, debtToEquity: 1.1, freeCashFlow: 9e10, marketCap: 3e12,
    });
    expect(sparse.available && rich.available).toBe(true);
    if (!sparse.available || !rich.available) return;
    expect(sparse.completeness).toBeLessThan(rich.completeness);
    expect(rich.completeness).toBe(1);
  });

  it('is unavailable, not neutral, when no fundamentals provider answered', () => {
    const result = analyseEquityFundamentals(null, { reason: 'no_provider_configured' });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.unavailable.reason).toBe('no_provider_configured');
  });
});

describe('crypto fundamentals module', () => {
  const base: CryptoMetrics = { symbol: 'TEST', source: 'coingecko', asOf: new Date() };

  it('computes dominance from the global market cap rather than assuming one', () => {
    const withGlobal = analyseCryptoFundamentals(
      { ...base, marketCap: 1.2e12, volume24h: 4e10 },
      { totalMarketCap: 2.4e12, totalVolume24h: 1e11, btcDominance: 50, marketCapChange24h: 1.2, source: 'coingecko', asOf: new Date() },
      null,
    );
    expect(withGlobal.available).toBe(true);
    if (!withGlobal.available) return;
    expect(withGlobal.metrics.find((m) => m.label === 'Dominance')?.value).toBe('50%');

    const withoutGlobal = analyseCryptoFundamentals({ ...base, marketCap: 1.2e12, volume24h: 4e10 }, null, null);
    expect(withoutGlobal.available).toBe(true);
    if (!withoutGlobal.available) return;
    expect(withoutGlobal.metrics.find((m) => m.label === 'Dominance')?.value).toBeNull();
  });

  it('warns about supply overhang when most of the maximum supply is unissued', () => {
    const result = analyseCryptoFundamentals(
      { ...base, marketCap: 5e9, volume24h: 2e8, circulatingSupply: 30e6, maxSupply: 100e6 },
      null,
      null,
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.evidence.some((e) => e.kind === 'warning' && e.text.includes('maximum supply is circulating'))).toBe(true);
  });

  it('measures volatility and growth from the price series when one is supplied', () => {
    const withSeries = analyseCryptoFundamentals(
      { ...base, marketCap: 5e10, volume24h: 2e9 },
      null,
      series(300, 100, 0.3),
    );
    expect(withSeries.available).toBe(true);
    if (!withSeries.available) return;
    expect(withSeries.metrics.find((m) => m.label === 'Volatility (30d)')?.value).not.toBeNull();
    expect(withSeries.metrics.find((m) => m.label === 'Growth (1y)')?.value).not.toBeNull();
  });
});

describe('sentiment module', () => {
  const article = (headline: string, daysAgo = 1, outlet = 'Reuters'): NewsArticle => ({
    id: `${headline}-${daysAgo}`,
    headline,
    url: 'https://example.com',
    publishedAt: new Date(Date.now() - daysAgo * day),
    outlet,
    source: 'finnhub',
  });

  it('is unavailable — never neutral — when no news provider covers the asset', () => {
    const result = analyseSentiment(null, { reason: 'not_supported', detail: 'no crypto news source' });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.unavailable.detail).toBe('no crypto news source');
  });

  it('is unavailable when the provider returned an empty list', () => {
    expect(analyseSentiment([]).available).toBe(false);
  });

  it('matches lexicon terms on word boundaries only', () => {
    // "banned" must not fire on "abandoned"; "miss" must not fire on "mission".
    expect(scoreArticle(article('Company abandoned its mission statement')).terms).toEqual([]);
    expect(scoreArticle(article('Regulator banned the product')).terms).toContain('banned');
  });

  it('scores positive and negative coverage in the right direction', () => {
    const good = analyseSentiment([
      article('Chipmaker beats expectations and raises guidance'),
      article('Analysts upgrade the stock after record high revenue'),
    ]);
    const bad = analyseSentiment([
      article('Regulator opens investigation into accounting fraud'),
      article('Company cuts guidance as demand plunges'),
    ]);
    expect(good.available && bad.available).toBe(true);
    if (!good.available || !bad.available) return;

    expect(good.score).toBeGreaterThan(60);
    expect(bad.score).toBeLessThan(40);
  });

  it('weights recent coverage above stale coverage', () => {
    const fresh = analyseSentiment([article('Company beats expectations', 0), article('Company faces lawsuit', 20)]);
    const stale = analyseSentiment([article('Company beats expectations', 20), article('Company faces lawsuit', 0)]);
    expect(fresh.available && stale.available).toBe(true);
    if (!fresh.available || !stale.available) return;
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it('quotes the headline and outlet it is reacting to', () => {
    const result = analyseSentiment([article('Company wins landmark approval', 1, 'Bloomberg')]);
    expect(result.available).toBe(true);
    if (!result.available) return;
    const cited = result.evidence.find((e) => e.text.includes('landmark approval'));
    expect(cited?.text).toContain('Bloomberg');
  });

  it('says coverage is neutral rather than silent when no term matched', () => {
    const result = analyseSentiment([article('Company schedules its annual general meeting')]);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.score).toBe(50);
    expect(result.evidence[0]?.text).toContain('no term in the sentiment lexicon');
  });
});

describe('risk module', () => {
  const base = { kind: 'equity' as const, maxDrawdown: 20, atrPercent: 1.5, marketCap: 5e10, bars: 300 };

  it('classifies by measured volatility', () => {
    expect(classifyRisk({ ...base, volatility: 15 })?.level).toBe('Low Risk');
    expect(classifyRisk({ ...base, volatility: 35 })?.level).toBe('Medium Risk');
    expect(classifyRisk({ ...base, volatility: 65 })?.level).toBe('High Risk');
    expect(classifyRisk({ ...base, volatility: 110 })?.level).toBe('Very High Risk');
  });

  it('escalates for a deep drawdown and for illiquid size', () => {
    expect(classifyRisk({ ...base, volatility: 30, maxDrawdown: 72 })?.level).toBe('High Risk');
    expect(classifyRisk({ ...base, volatility: 30, marketCap: 4e8 })?.level).toBe('High Risk');
    expect(classifyRisk({ kind: 'crypto', volatility: 30, maxDrawdown: 20, atrPercent: 3, marketCap: 5e7, bars: 300 })?.level)
      .toBe('Very High Risk');
  });

  it('escalates when the history is too short to have seen a drawdown cycle', () => {
    const short = classifyRisk({ ...base, volatility: 15, bars: 45 });
    expect(short?.level).toBe('Medium Risk');
    expect(short?.drivers.some((d) => d.includes('45 daily bars'))).toBe(true);
  });

  it('returns null rather than a default level when volatility is unmeasurable', () => {
    expect(classifyRisk({ ...base, volatility: undefined })).toBeNull();
  });

  it('explains every classification with measured drivers', () => {
    const risk = classifyRisk({ ...base, volatility: 65 });
    expect(risk?.drivers.length).toBeGreaterThanOrEqual(2);
    expect(risk?.drivers.every((d) => /\d/.test(d))).toBe(true);
  });
});

describe('levels module', () => {
  it('places the stop below the entry band and pays at least 2:1 when it invents a target', () => {
    const levels = deriveLevels({ price: 100, atr: 2, support: [92, 96], resistance: [] });
    expect(levels).not.toBeNull();
    if (!levels) return;

    expect(levels.stopLoss).toBeLessThan(levels.entryLow);
    expect(levels.entryLow).toBeLessThanOrEqual(levels.entryHigh);
    expect(levels.target).toBeGreaterThan(levels.entryHigh);
    expect(levels.rewardRisk).toBeGreaterThanOrEqual(1.99);
    expect(levels.basis).toContain('ATR(14)');
  });

  it('uses a real resistance level as the target when it pays for the risk', () => {
    const levels = deriveLevels({ price: 100, atr: 2, support: [96], resistance: [120] });
    expect(levels?.target).toBe(120);
    expect(levels?.basis).toContain('pivot resistance');
  });

  it('ignores resistance that sits too close to pay for the risk', () => {
    const levels = deriveLevels({ price: 100, atr: 2, support: [96], resistance: [101] });
    expect(levels?.target).not.toBe(101);
    expect(levels?.basis).toContain('too close');
  });

  it('returns null without an ATR rather than guessing a stop', () => {
    expect(deriveLevels({ price: 100, atr: undefined, support: [90], resistance: [110] })).toBeNull();
    expect(deriveLevels({ price: 0, atr: 2, support: [], resistance: [] })).toBeNull();
  });
});
