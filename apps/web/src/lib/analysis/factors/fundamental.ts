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
  const c: Contribution[] = [];

  // Analyst estimates are gathered before the early return, because they arrive
  // from a different capability than the statement metrics. A vendor serving
  // targets but not fundamentals is a real configuration, and bailing out above
  // would silently discard evidence the engine actually holds.
  if (!f) {
    const analystOnly = analystContributions(ctx);
    if (analystOnly.length === 0) {
      return { factor: 'fundamental', unavailable: true, reason: 'no fundamentals available' };
    }
    const total = analystOnly.reduce((s, x) => s + x.weight, 0);
    return {
      factor: 'fundamental',
      score: analystOnly.reduce((s, x) => s + x.score * x.weight, 0) / total,
      confidence: Math.min(1, total / 1.0),
      signals: analystOnly.sort((x, y) => y.weight - x.weight).map((x) => x.signal),
    };
  }

  const src = f.source;

  if (f.peRatio !== undefined && f.peRatio > 0) {
    // Cheap is good, but a very low P/E often signals distress rather than value,
    // so the scale tops out rather than rewarding ever-lower ratios.
    const score = band(f.peRatio, 60, 8);
    c.push({
      weight: 0.16,
      score,
      signal: {
        label: 'P/E (TTM)',
        value: fmt(f.peRatio),
        direction: f.peRatio < 18 ? 'bullish' : f.peRatio > 40 ? 'bearish' : 'neutral',
        weight: 0.16,
        source: src,
      },
    });
  }

  if (f.pegRatio !== undefined && f.pegRatio > 0) {
    const score = band(f.pegRatio, 3, 0.7);
    c.push({
      weight: 0.12,
      score,
      signal: {
        label: 'PEG ratio',
        value: fmt(f.pegRatio),
        direction: f.pegRatio < 1 ? 'bullish' : f.pegRatio > 2 ? 'bearish' : 'neutral',
        weight: 0.12,
        source: src,
      },
    });
  }

  if (f.revenueGrowthYoY !== undefined) {
    const score = band(f.revenueGrowthYoY, -10, 35);
    c.push({
      weight: 0.18,
      score,
      signal: {
        label: 'Revenue growth (YoY)',
        value: pct(f.revenueGrowthYoY),
        direction:
          f.revenueGrowthYoY > 10 ? 'bullish' : f.revenueGrowthYoY < 0 ? 'bearish' : 'neutral',
        weight: 0.18,
        source: src,
      },
    });
  }

  if (f.earningsGrowthYoY !== undefined) {
    const score = band(f.earningsGrowthYoY, -20, 40);
    c.push({
      weight: 0.14,
      score,
      signal: {
        label: 'Earnings growth (YoY)',
        value: pct(f.earningsGrowthYoY),
        direction:
          f.earningsGrowthYoY > 10 ? 'bullish' : f.earningsGrowthYoY < 0 ? 'bearish' : 'neutral',
        weight: 0.14,
        source: src,
      },
    });
  }

  if (f.profitMargin !== undefined) {
    const score = band(f.profitMargin, -5, 30);
    c.push({
      weight: 0.12,
      score,
      signal: {
        label: 'Net profit margin',
        value: pct(f.profitMargin),
        direction: f.profitMargin > 15 ? 'bullish' : f.profitMargin < 0 ? 'bearish' : 'neutral',
        weight: 0.12,
        source: src,
      },
    });
  }

  if (f.roe !== undefined) {
    const score = band(f.roe, 0, 30);
    c.push({
      weight: 0.1,
      score,
      signal: {
        label: 'Return on equity',
        value: pct(f.roe),
        direction: f.roe > 15 ? 'bullish' : f.roe < 5 ? 'bearish' : 'neutral',
        weight: 0.1,
        source: src,
      },
    });
  }

  if (f.roic !== undefined) {
    c.push({
      weight: 0.08,
      score: band(f.roic, 0, 20),
      signal: {
        label: 'Return on invested capital',
        value: pct(f.roic),
        direction: f.roic > 12 ? 'bullish' : f.roic < 4 ? 'bearish' : 'neutral',
        weight: 0.08,
        source: src,
      },
    });
  }

  if (f.debtToEquity !== undefined) {
    // Lower leverage scores higher; the scale is generous because capital
    // structure norms vary enormously by sector.
    const score = band(f.debtToEquity, 250, 20);
    c.push({
      weight: 0.1,
      score,
      signal: {
        label: 'Debt / equity',
        value: fmt(f.debtToEquity),
        direction: f.debtToEquity < 60 ? 'bullish' : f.debtToEquity > 150 ? 'bearish' : 'neutral',
        weight: 0.1,
        source: src,
      },
    });
  }

  if (f.dividendYield !== undefined && f.dividendYield > 0) {
    c.push({
      weight: 0.05,
      score: band(f.dividendYield, 0, 5),
      signal: {
        label: 'Dividend yield',
        value: pct(f.dividendYield),
        direction: f.dividendYield > 2 ? 'bullish' : 'neutral',
        weight: 0.05,
        source: src,
      },
    });
  }

  if (f.freeCashFlow !== undefined) {
    const positive = f.freeCashFlow > 0;
    c.push({
      weight: 0.08,
      score: positive ? 72 : 25,
      signal: {
        label: 'Free cash flow (TTM)',
        value: `${positive ? '' : '-'}${Math.abs(f.freeCashFlow).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
        direction: positive ? 'bullish' : 'bearish',
        weight: 0.08,
        source: src,
      },
    });
  }

  c.push(...analystContributions(ctx));

  if (c.length === 0) {
    return {
      factor: 'fundamental',
      unavailable: true,
      reason: 'provider returned no usable metrics',
    };
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

/**
 * Sell-side estimates as fundamental evidence.
 *
 * Held to a deliberately modest combined weight (0.17 of ~1.3). Analyst targets
 * are forecasts, and forecasts are systematically optimistic — the published
 * distribution across US large caps is roughly ten buys to one sell, so a naive
 * mapping of "mostly buys" onto a high score would push almost every covered
 * equity upward and turn the factor into a proxy for how many analysts follow
 * the name. Two guards keep that from happening:
 *
 *  1. **Upside is measured against the consensus, and capped.** A target 60%
 *     above spot is not four times better evidence than one 15% above; past a
 *     point it means the analysts have not updated since a drawdown.
 *  2. **The rating mix is scored on its *net* balance**, so the sell-side's
 *     structural bullishness lands mid-scale rather than at the top. Only an
 *     unusually negative distribution moves the score meaningfully, which is the
 *     part that actually carries information.
 */
function analystContributions(ctx: AssetContext): Contribution[] {
  const a = ctx.analyst;
  if (!a) return [];

  const out: Contribution[] = [];
  const src = a.source;
  const price = ctx.quote?.price;

  if (
    a.targetConsensus !== undefined &&
    a.targetConsensus > 0 &&
    price !== undefined &&
    price > 0
  ) {
    const upside = ((a.targetConsensus - price) / price) * 100;
    // Capped at ±40%: beyond that the target is usually stale rather than bold.
    // The band's endpoints sit *outside* that cap (-35 → +50) so even a maximally
    // optimistic consensus lands near 88 rather than exactly 100. A sub-score
    // that saturates stops carrying information at precisely the values where
    // the difference between "very good" and "implausible" matters most.
    const score = band(Math.max(-40, Math.min(40, upside)), -35, 50);
    out.push({
      weight: 0.1,
      score,
      signal: {
        label: 'Upside to analyst consensus target',
        value: `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}% (target ${a.targetConsensus.toFixed(2)})`,
        direction: upside > 10 ? 'bullish' : upside < -5 ? 'bearish' : 'neutral',
        weight: 0.1,
        source: src,
      },
    });
  }

  const buys = (a.strongBuy ?? 0) + (a.buy ?? 0);
  const sells = (a.sell ?? 0) + (a.strongSell ?? 0);
  const holds = a.hold ?? 0;
  const rated = buys + sells + holds;

  if (rated > 0) {
    // Net balance in [-1, 1]. The band runs to ±1.4 — wider than the metric can
    // ever reach — so the endpoints are unattainable by construction: a
    // unanimous buy book scores ~86 and a unanimous sell book ~14, while a
    // balanced one sits at exactly 50. An earlier version topped out at 0.9,
    // which meant the ordinary all-buy distribution of a covered large cap
    // (net ≈ 0.95) pinned the sub-score at 100 and made the signal a proxy for
    // analyst coverage rather than analyst opinion.
    const net = (buys - sells) / rated;
    out.push({
      weight: 0.07,
      score: band(net, -1.4, 1.4),
      signal: {
        label: 'Analyst rating mix',
        value: `${buys} buy / ${holds} hold / ${sells} sell`,
        direction: net > 0.5 ? 'bullish' : net < 0 ? 'bearish' : 'neutral',
        weight: 0.07,
        source: src,
      },
    });
  }

  return out;
}

function scoreCrypto(ctx: AssetContext): FactorOutcome {
  const m = ctx.cryptoMetrics;
  if (!m)
    return {
      factor: 'fundamental',
      unavailable: true,
      reason: 'no on-chain/network metrics available',
    };

  const src = m.source;
  const c: Contribution[] = [];

  if (m.rank !== undefined) {
    // Rank is a liquidity and durability proxy; the top ~20 are qualitatively
    // different from the long tail.
    const score = band(m.rank, 300, 1);
    c.push({
      weight: 0.2,
      score,
      signal: {
        label: 'Market cap rank',
        value: `#${m.rank}`,
        direction: m.rank <= 20 ? 'bullish' : m.rank > 150 ? 'bearish' : 'neutral',
        weight: 0.2,
        source: src,
      },
    });
  }

  if (m.marketCap !== undefined && m.volume24h !== undefined && m.marketCap > 0) {
    // Turnover: 24h volume relative to market cap. Healthy liquidity without the
    // extreme churn that usually accompanies a blow-off move.
    const turnover = (m.volume24h / m.marketCap) * 100;
    const score = turnover > 40 ? 45 : band(turnover, 0.2, 12);
    c.push({
      weight: 0.22,
      score,
      signal: {
        label: '24h volume / market cap',
        value: pct(turnover),
        direction:
          turnover > 3 && turnover < 40 ? 'bullish' : turnover < 0.5 ? 'bearish' : 'neutral',
        weight: 0.22,
        source: src,
      },
    });
  }

  if (m.circulatingSupply !== undefined && m.maxSupply !== undefined && m.maxSupply > 0) {
    // High circulating share means less future dilution from unlocks.
    const circulatingShare = (m.circulatingSupply / m.maxSupply) * 100;
    c.push({
      weight: 0.2,
      score: band(circulatingShare, 30, 95),
      signal: {
        label: 'Circulating / max supply',
        value: pct(circulatingShare),
        direction:
          circulatingShare > 80 ? 'bullish' : circulatingShare < 50 ? 'bearish' : 'neutral',
        weight: 0.2,
        source: src,
      },
    });
  }

  if (m.githubCommits4w !== undefined) {
    c.push({
      weight: 0.22,
      score: band(m.githubCommits4w, 0, 120),
      signal: {
        label: 'Developer commits (4w)',
        value: String(m.githubCommits4w),
        direction:
          m.githubCommits4w > 40 ? 'bullish' : m.githubCommits4w < 5 ? 'bearish' : 'neutral',
        weight: 0.22,
        source: src,
      },
    });
  }

  if (m.githubStars !== undefined) {
    c.push({
      weight: 0.1,
      score: band(m.githubStars, 0, 20_000),
      signal: {
        label: 'GitHub stars',
        value: m.githubStars.toLocaleString('en-US'),
        direction: m.githubStars > 5_000 ? 'bullish' : 'neutral',
        weight: 0.1,
        source: src,
      },
    });
  }

  if (c.length === 0) {
    return {
      factor: 'fundamental',
      unavailable: true,
      reason: 'provider returned no usable metrics',
    };
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
