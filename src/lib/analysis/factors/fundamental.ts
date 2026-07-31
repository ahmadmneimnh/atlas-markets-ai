import type { AssetContext, FactorOutcome, FactorScorer, Signal } from '../types';

/**
 * Fundamental factor (nominal weight 30%).
 *
 * Equities are scored on valuation, growth, profitability and leverage; crypto on
 * network and supply metrics, since P/E has no meaning for a token. Both paths drop
 * any metric the provider did not return rather than substituting a sector average —
 * an imputed value is indistinguishable from a real one once it reaches the UI.
 */

interface Contribution {
  weight: number;
  score: number;
  signal: Signal;
}

/** Maps a value onto 0–100 where `good` scores 100 and `bad` scores 0. */
function band(value: number, bad: number, good: number): number {
  if (good === bad) return 50;
  const t = (value - bad) / (good - bad);
  return Math.max(0, Math.min(100, t * 100));
}

const fmt = (n: number, digits = 2) => n.toFixed(digits);
const pct = (n: number) => `${n.toFixed(1)}%`;

function scoreEquity(ctx: AssetContext): FactorOutcome {
  const f = ctx.fundamentals;
  if (!f) return { factor: 'fundamental', unavailable: true, reason: 'no fundamentals available' };

  const src = f.source;
  const c: Contribution[] = [];

  if (f.peRatio !== undefined && f.peRatio > 0) {
    // Cheap is good, but a very low P/E often signals distress rather than value,
    // so the scale tops out rather than rewarding ever-lower ratios.
    const score = band(f.peRatio, 60, 8);
    c.push({
      weight: 0.16, score,
      signal: {
        label: 'P/E (TTM)', value: fmt(f.peRatio),
        direction: f.peRatio < 18 ? 'bullish' : f.peRatio > 40 ? 'bearish' : 'neutral',
        weight: 0.16, source: src,
      },
    });
  }

  if (f.pegRatio !== undefined && f.pegRatio > 0) {
    const score = band(f.pegRatio, 3, 0.7);
    c.push({
      weight: 0.12, score,
      signal: {
        label: 'PEG ratio', value: fmt(f.pegRatio),
        direction: f.pegRatio < 1 ? 'bullish' : f.pegRatio > 2 ? 'bearish' : 'neutral',
        weight: 0.12, source: src,
      },
    });
  }

  if (f.revenueGrowthYoY !== undefined) {
    const score = band(f.revenueGrowthYoY, -10, 35);
    c.push({
      weight: 0.18, score,
      signal: {
        label: 'Revenue growth (YoY)', value: pct(f.revenueGrowthYoY),
        direction: f.revenueGrowthYoY > 10 ? 'bullish' : f.revenueGrowthYoY < 0 ? 'bearish' : 'neutral',
        weight: 0.18, source: src,
      },
    });
  }

  if (f.earningsGrowthYoY !== undefined) {
    const score = band(f.earningsGrowthYoY, -20, 40);
    c.push({
      weight: 0.14, score,
      signal: {
        label: 'Earnings growth (YoY)', value: pct(f.earningsGrowthYoY),
        direction: f.earningsGrowthYoY > 10 ? 'bullish' : f.earningsGrowthYoY < 0 ? 'bearish' : 'neutral',
        weight: 0.14, source: src,
      },
    });
  }

  if (f.profitMargin !== undefined) {
    const score = band(f.profitMargin, -5, 30);
    c.push({
      weight: 0.12, score,
      signal: {
        label: 'Net profit margin', value: pct(f.profitMargin),
        direction: f.profitMargin > 15 ? 'bullish' : f.profitMargin < 0 ? 'bearish' : 'neutral',
        weight: 0.12, source: src,
      },
    });
  }

  if (f.roe !== undefined) {
    const score = band(f.roe, 0, 30);
    c.push({
      weight: 0.1, score,
      signal: {
        label: 'Return on equity', value: pct(f.roe),
        direction: f.roe > 15 ? 'bullish' : f.roe < 5 ? 'bearish' : 'neutral',
        weight: 0.1, source: src,
      },
    });
  }

  if (f.roic !== undefined) {
    c.push({
      weight: 0.08, score: band(f.roic, 0, 20),
      signal: {
        label: 'Return on invested capital', value: pct(f.roic),
        direction: f.roic > 12 ? 'bullish' : f.roic < 4 ? 'bearish' : 'neutral',
        weight: 0.08, source: src,
      },
    });
  }

  if (f.debtToEquity !== undefined) {
    // Lower leverage scores higher; the scale is generous because capital
    // structure norms vary enormously by sector.
    const score = band(f.debtToEquity, 250, 20);
    c.push({
      weight: 0.1, score,
      signal: {
        label: 'Debt / equity', value: fmt(f.debtToEquity),
        direction: f.debtToEquity < 60 ? 'bullish' : f.debtToEquity > 150 ? 'bearish' : 'neutral',
        weight: 0.1, source: src,
      },
    });
  }

  if (f.dividendYield !== undefined && f.dividendYield > 0) {
    c.push({
      weight: 0.05, score: band(f.dividendYield, 0, 5),
      signal: {
        label: 'Dividend yield', value: pct(f.dividendYield),
        direction: f.dividendYield > 2 ? 'bullish' : 'neutral',
        weight: 0.05, source: src,
      },
    });
  }

  if (f.freeCashFlow !== undefined) {
    const positive = f.freeCashFlow > 0;
    c.push({
      weight: 0.08, score: positive ? 72 : 25,
      signal: {
        label: 'Free cash flow (TTM)',
        value: `${positive ? '' : '-'}${Math.abs(f.freeCashFlow).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
        direction: positive ? 'bullish' : 'bearish',
        weight: 0.08, source: src,
      },
    });
  }

  if (c.length === 0) {
    return { factor: 'fundamental', unavailable: true, reason: 'provider returned no usable metrics' };
  }

  const total = c.reduce((s, x) => s + x.weight, 0);
  return {
    factor: 'fundamental',
    score: c.reduce((s, x) => s + x.score * x.weight, 0) / total,
    // Full coverage is ~1.13; partial coverage lowers confidence proportionally.
    confidence: Math.min(1, total / 1.0),
    signals: c.sort((x, y) => y.weight - x.weight).map((x) => x.signal),
  };
}

function scoreCrypto(ctx: AssetContext): FactorOutcome {
  const m = ctx.cryptoMetrics;
  if (!m) return { factor: 'fundamental', unavailable: true, reason: 'no on-chain/network metrics available' };

  const src = m.source;
  const c: Contribution[] = [];

  if (m.rank !== undefined) {
    // Rank is a liquidity and durability proxy; the top ~20 are qualitatively
    // different from the long tail.
    const score = band(m.rank, 300, 1);
    c.push({
      weight: 0.2, score,
      signal: {
        label: 'Market cap rank', value: `#${m.rank}`,
        direction: m.rank <= 20 ? 'bullish' : m.rank > 150 ? 'bearish' : 'neutral',
        weight: 0.2, source: src,
      },
    });
  }

  if (m.marketCap !== undefined && m.volume24h !== undefined && m.marketCap > 0) {
    // Turnover: 24h volume relative to market cap. Healthy liquidity without the
    // extreme churn that usually accompanies a blow-off move.
    const turnover = (m.volume24h / m.marketCap) * 100;
    const score = turnover > 40 ? 45 : band(turnover, 0.2, 12);
    c.push({
      weight: 0.22, score,
      signal: {
        label: '24h volume / market cap', value: pct(turnover),
        direction: turnover > 3 && turnover < 40 ? 'bullish' : turnover < 0.5 ? 'bearish' : 'neutral',
        weight: 0.22, source: src,
      },
    });
  }

  if (m.circulatingSupply !== undefined && m.maxSupply !== undefined && m.maxSupply > 0) {
    // High circulating share means less future dilution from unlocks.
    const circulatingShare = (m.circulatingSupply / m.maxSupply) * 100;
    c.push({
      weight: 0.2, score: band(circulatingShare, 30, 95),
      signal: {
        label: 'Circulating / max supply', value: pct(circulatingShare),
        direction: circulatingShare > 80 ? 'bullish' : circulatingShare < 50 ? 'bearish' : 'neutral',
        weight: 0.2, source: src,
      },
    });
  }

  if (m.githubCommits4w !== undefined) {
    c.push({
      weight: 0.22, score: band(m.githubCommits4w, 0, 120),
      signal: {
        label: 'Developer commits (4w)', value: String(m.githubCommits4w),
        direction: m.githubCommits4w > 40 ? 'bullish' : m.githubCommits4w < 5 ? 'bearish' : 'neutral',
        weight: 0.22, source: src,
      },
    });
  }

  if (m.githubStars !== undefined) {
    c.push({
      weight: 0.1, score: band(m.githubStars, 0, 20_000),
      signal: {
        label: 'GitHub stars', value: m.githubStars.toLocaleString('en-US'),
        direction: m.githubStars > 5_000 ? 'bullish' : 'neutral',
        weight: 0.1, source: src,
      },
    });
  }

  if (c.length === 0) {
    return { factor: 'fundamental', unavailable: true, reason: 'provider returned no usable metrics' };
  }

  const total = c.reduce((s, x) => s + x.weight, 0);
  return {
    factor: 'fundamental',
    score: c.reduce((s, x) => s + x.score * x.weight, 0) / total,
    confidence: Math.min(1, total / 0.94),
    signals: c.sort((x, y) => y.weight - x.weight).map((x) => x.signal),
  };
}

export const fundamentalScorer: FactorScorer = {
  factor: 'fundamental',
  weight: 30,
  score(ctx: AssetContext): FactorOutcome {
    return ctx.ref.kind === 'crypto' ? scoreCrypto(ctx) : scoreEquity(ctx);
  },
};
