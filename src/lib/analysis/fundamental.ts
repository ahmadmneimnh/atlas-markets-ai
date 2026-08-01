import type { CryptoGlobal, CryptoMetrics, Fundamentals, OhlcvSeries } from '@/lib/providers/types';
import { formatCompact, formatNumber, formatPercent } from '@/lib/format';
import { momentum, volatility } from './indicators';
import { clamp } from './technical';
import {
  moduleUnavailable, reason, warning,
  type Evidence, type Metric, type ModuleResult,
} from './types';

/**
 * Fundamental analysis.
 *
 * Stocks and crypto get different treatments because they have different
 * fundamentals — a P/E ratio does not exist for a token, and circulating supply does
 * not exist for a company. Both paths share one rule: a field the provider did not
 * return contributes no vote and lowers `completeness`, so partial data produces a
 * weaker signal rather than a wrong one.
 */

interface Vote {
  weight: number;
  vote: number;
}

/** Scores a value against thresholds, returning a vote in [-1, 1]. */
function band(value: number, thresholds: { good: number; bad: number }): number {
  const { good, bad } = thresholds;
  if (good > bad) {
    // Higher is better.
    if (value >= good) return 1;
    if (value <= bad) return -1;
    return ((value - bad) / (good - bad)) * 2 - 1;
  }
  // Lower is better.
  if (value <= good) return 1;
  if (value >= bad) return -1;
  return ((bad - value) / (bad - good)) * 2 - 1;
}

// ── Equities ────────────────────────────────────────────────────────────────────

export function analyseEquityFundamentals(
  fundamentals: Fundamentals | null,
  unavailable?: { reason: Parameters<typeof moduleUnavailable>[2]; detail?: string },
): ModuleResult {
  const label = 'Fundamentals';

  if (!fundamentals) {
    return moduleUnavailable(
      'fundamental',
      label,
      unavailable?.reason ?? 'no_provider_configured',
      unavailable?.detail ?? 'no fundamentals provider is configured (Finnhub or Alpha Vantage)',
    );
  }

  const f = fundamentals;
  const votes: Vote[] = [];
  const evidence: Evidence[] = [];
  const add = (weight: number, vote: number) => votes.push({ weight, vote: clamp(vote, -1, 1) });

  // Revenue growth.
  if (f.revenueGrowthYoY !== undefined) {
    add(2, band(f.revenueGrowthYoY, { good: 20, bad: 0 }));
    if (f.revenueGrowthYoY >= 10) {
      evidence.push(reason('fundamental', `Revenue growing ${formatPercent(f.revenueGrowthYoY)} year over year`, 'bullish', f.revenueGrowthYoY >= 20 ? 'high' : 'medium'));
    } else if (f.revenueGrowthYoY < 0) {
      evidence.push(warning('fundamental', `Revenue shrinking ${formatPercent(f.revenueGrowthYoY)} year over year`, 'high'));
    }
  }

  // Earnings growth.
  if (f.earningsGrowthYoY !== undefined) {
    add(1.5, band(f.earningsGrowthYoY, { good: 15, bad: -5 }));
    if (f.earningsGrowthYoY >= 15) {
      evidence.push(reason('fundamental', `Earnings per share up ${formatPercent(f.earningsGrowthYoY)} year over year`, 'bullish', 'medium'));
    } else if (f.earningsGrowthYoY < 0) {
      evidence.push(warning('fundamental', `Earnings per share down ${formatPercent(f.earningsGrowthYoY)} year over year`, 'medium'));
    }
  }

  // Profitability.
  if (f.profitMargin !== undefined) {
    add(2, band(f.profitMargin, { good: 15, bad: 0 }));
    if (f.profitMargin >= 15) {
      evidence.push(reason('fundamental', `Net profit margin of ${formatPercent(f.profitMargin)} — pricing power, not just revenue`, 'bullish', 'medium'));
    } else if (f.profitMargin < 0) {
      evidence.push(warning('fundamental', `Loss-making: net margin ${formatPercent(f.profitMargin)}`, 'high'));
    }
  }

  if (f.roe !== undefined) {
    add(1, band(f.roe, { good: 18, bad: 5 }));
    if (f.roe >= 18) {
      evidence.push(reason('fundamental', `Return on equity of ${formatPercent(f.roe)}`, 'bullish', 'low'));
    }
  }

  // Valuation. A negative P/E means losses, which the margin check already covers —
  // scoring it as "cheap" is the classic way to make a loss-maker look attractive.
  if (f.peRatio !== undefined) {
    if (f.peRatio <= 0) {
      add(2, -0.5);
      evidence.push(warning('fundamental', 'No meaningful P/E — the company is not profitable on a trailing basis', 'medium'));
    } else {
      add(2, band(f.peRatio, { good: 15, bad: 45 }));
      if (f.peRatio > 45) {
        evidence.push(warning('fundamental', `High valuation: trailing P/E of ${formatNumber(f.peRatio, 1)} leaves little room for disappointment`, 'high'));
      } else if (f.peRatio < 15) {
        evidence.push(reason('fundamental', `Trading at ${formatNumber(f.peRatio, 1)}× trailing earnings`, 'bullish', 'medium'));
      }
    }
  }

  if (f.pegRatio !== undefined && f.pegRatio > 0) {
    add(1, band(f.pegRatio, { good: 1, bad: 3 }));
    if (f.pegRatio < 1) {
      evidence.push(reason('fundamental', `PEG of ${formatNumber(f.pegRatio, 2)} — growth is not fully priced in`, 'bullish', 'medium'));
    } else if (f.pegRatio > 3) {
      evidence.push(warning('fundamental', `PEG of ${formatNumber(f.pegRatio, 2)} — paying a lot for the growth on offer`, 'medium'));
    }
  }

  // Balance sheet.
  if (f.debtToEquity !== undefined) {
    add(1.5, band(f.debtToEquity, { good: 0.5, bad: 2.5 }));
    if (f.debtToEquity > 2.5) {
      evidence.push(warning('fundamental', `Debt-to-equity of ${formatNumber(f.debtToEquity, 2)} — leverage amplifies any downturn`, 'high'));
    } else if (f.debtToEquity < 0.5) {
      evidence.push(reason('fundamental', `Conservative balance sheet: debt-to-equity of ${formatNumber(f.debtToEquity, 2)}`, 'bullish', 'low'));
    }
  }

  // Cash generation.
  if (f.freeCashFlow !== undefined) {
    add(1.5, f.freeCashFlow > 0 ? 0.8 : -0.8);
    evidence.push(
      f.freeCashFlow > 0
        ? reason('fundamental', `Free cash flow positive at $${formatCompact(f.freeCashFlow)}`, 'bullish', 'medium')
        : warning('fundamental', `Free cash flow negative at $${formatCompact(f.freeCashFlow)} — the business consumes cash`, 'high'),
    );
  }

  // Size, as a stability input rather than a quality one.
  if (f.marketCap !== undefined) {
    add(0.5, band(f.marketCap, { good: 50e9, bad: 2e9 }));
    if (f.marketCap < 2e9) {
      evidence.push(warning('fundamental', `Small capitalisation ($${formatCompact(f.marketCap)}) — thinner liquidity and wider swings`, 'low'));
    }
  }

  if (votes.length === 0) {
    return moduleUnavailable('fundamental', label, 'not_found', 'the provider returned a fundamentals record with no usable fields');
  }

  const fields = [
    f.revenueGrowthYoY, f.earningsGrowthYoY, f.profitMargin, f.roe, f.peRatio,
    f.pegRatio, f.debtToEquity, f.freeCashFlow, f.eps, f.marketCap,
  ];

  return {
    id: 'fundamental',
    label,
    available: true,
    score: scoreFrom(votes),
    completeness: fields.filter((v) => v !== undefined).length / fields.length,
    evidence,
    metrics: [
      { label: 'Market cap', value: f.marketCap === undefined ? null : `$${formatCompact(f.marketCap)}` },
      { label: 'P/E (TTM)', value: f.peRatio === undefined ? null : formatNumber(f.peRatio, 1) },
      { label: 'PEG', value: f.pegRatio === undefined ? null : formatNumber(f.pegRatio, 2) },
      { label: 'EPS (TTM)', value: f.eps === undefined ? null : formatNumber(f.eps, 2) },
      { label: 'Revenue growth', value: f.revenueGrowthYoY === undefined ? null : formatPercent(f.revenueGrowthYoY), hint: 'Year over year' },
      { label: 'Earnings growth', value: f.earningsGrowthYoY === undefined ? null : formatPercent(f.earningsGrowthYoY), hint: 'Year over year' },
      { label: 'Profit margin', value: f.profitMargin === undefined ? null : formatPercent(f.profitMargin) },
      { label: 'Return on equity', value: f.roe === undefined ? null : formatPercent(f.roe) },
      { label: 'Debt / equity', value: f.debtToEquity === undefined ? null : formatNumber(f.debtToEquity, 2) },
      { label: 'Free cash flow', value: f.freeCashFlow === undefined ? null : `$${formatCompact(f.freeCashFlow)}` },
    ],
    sources: [f.source],
  };
}

// ── Crypto ──────────────────────────────────────────────────────────────────────

export function analyseCryptoFundamentals(
  metrics: CryptoMetrics | null,
  global: CryptoGlobal | null,
  series: OhlcvSeries | null,
  unavailable?: { reason: Parameters<typeof moduleUnavailable>[2]; detail?: string },
): ModuleResult {
  const label = 'Fundamentals';

  if (!metrics) {
    return moduleUnavailable(
      'fundamental',
      label,
      unavailable?.reason ?? 'no_provider_configured',
      unavailable?.detail ?? 'no coin statistics provider is configured',
    );
  }

  const m = metrics;
  const votes: Vote[] = [];
  const evidence: Evidence[] = [];
  const add = (weight: number, vote: number) => votes.push({ weight, vote: clamp(vote, -1, 1) });

  // Size, as a liquidity and survivability proxy.
  if (m.marketCap !== undefined) {
    add(2, band(m.marketCap, { good: 10e9, bad: 300e6 }));
    if (m.marketCap < 300e6) {
      evidence.push(warning('fundamental', `Micro capitalisation ($${formatCompact(m.marketCap)}) — a single seller can move the price`, 'high'));
    } else if (m.marketCap > 10e9) {
      evidence.push(reason('fundamental', `Large capitalisation ($${formatCompact(m.marketCap)}) among the most liquid assets in the class`, 'bullish', 'medium'));
    }
  }

  // Turnover: volume relative to capitalisation is the honest liquidity measure.
  if (m.volume24h !== undefined && m.marketCap !== undefined && m.marketCap > 0) {
    const turnover = (m.volume24h / m.marketCap) * 100;
    add(2, band(turnover, { good: 5, bad: 0.5 }));
    if (turnover < 0.5) {
      evidence.push(warning('fundamental', `24-hour volume is only ${formatNumber(turnover, 2)}% of market cap — thin liquidity`, 'high'));
    } else if (turnover > 10) {
      evidence.push(reason('fundamental', `Active turnover: 24-hour volume is ${formatNumber(turnover, 1)}% of market cap`, 'bullish', 'medium'));
    }
  }

  // Supply overhang: how much of the maximum supply is already issued.
  if (m.circulatingSupply !== undefined && m.maxSupply !== undefined && m.maxSupply > 0) {
    const issued = (m.circulatingSupply / m.maxSupply) * 100;
    add(1.5, band(issued, { good: 90, bad: 40 }));
    if (issued < 60) {
      evidence.push(warning('fundamental', `Only ${formatNumber(issued, 1)}% of maximum supply is circulating — future issuance dilutes holders`, 'medium'));
    } else if (issued > 90) {
      evidence.push(reason('fundamental', `${formatNumber(issued, 1)}% of maximum supply already circulating — little dilution left`, 'bullish', 'medium'));
    }
  } else if (m.circulatingSupply !== undefined && m.totalSupply !== undefined && m.totalSupply > 0) {
    const issued = (m.circulatingSupply / m.totalSupply) * 100;
    add(1, band(issued, { good: 90, bad: 50 }));
    if (issued < 70) {
      evidence.push(warning('fundamental', `${formatNumber(issued, 1)}% of total supply circulating — the remainder is an overhang`, 'medium'));
    }
  }

  // Dominance: this asset's share of the whole crypto market.
  let dominance: number | undefined;
  if (global && m.marketCap !== undefined && global.totalMarketCap > 0) {
    dominance = (m.marketCap / global.totalMarketCap) * 100;
    add(1, band(dominance, { good: 5, bad: 0.05 }));
    if (dominance >= 5) {
      evidence.push(reason('fundamental', `${formatNumber(dominance, 2)}% of total crypto market capitalisation — a core holding of the asset class`, 'bullish', 'medium'));
    }
  }

  if (m.rank !== undefined) {
    add(1, band(m.rank, { good: 10, bad: 200 }));
    if (m.rank <= 10) {
      evidence.push(reason('fundamental', `Ranked #${m.rank} by market capitalisation`, 'bullish', 'low'));
    } else if (m.rank > 200) {
      evidence.push(warning('fundamental', `Ranked #${m.rank} by market capitalisation — well outside the liquid tier`, 'medium'));
    }
  }

  // Realised volatility and long-run growth, measured from the price series.
  const closes = series?.candles.map((c) => c.close) ?? [];
  const vol = closes.length ? volatility(closes, 30) : undefined;
  const growth90 = closes.length ? momentum(closes, 90) : undefined;
  const growth365 = closes.length ? momentum(closes, 252) : undefined;

  if (vol !== undefined) {
    add(1.5, band(vol, { good: 40, bad: 120 }));
    if (vol > 120) {
      evidence.push(warning('fundamental', `Annualised volatility of ${formatNumber(vol, 0)}% — position sizing matters more than entry here`, 'high'));
    }
  }
  if (growth365 !== undefined) {
    add(1.5, clamp(growth365 / 100, -1, 1));
    if (growth365 > 50) {
      evidence.push(reason('fundamental', `Up ${formatPercent(growth365)} over the past year`, 'bullish', 'medium'));
    } else if (growth365 < -30) {
      evidence.push(warning('fundamental', `Down ${formatPercent(growth365)} over the past year`, 'medium'));
    }
  }
  if (growth90 !== undefined) {
    add(1, clamp(growth90 / 50, -1, 1));
  }

  if (votes.length === 0) {
    return moduleUnavailable('fundamental', label, 'not_found', 'the provider returned coin statistics with no usable fields');
  }

  const fields = [m.marketCap, m.volume24h, m.circulatingSupply, m.totalSupply, m.maxSupply, m.rank, dominance, vol, growth365];

  return {
    id: 'fundamental',
    label,
    available: true,
    score: scoreFrom(votes),
    completeness: fields.filter((v) => v !== undefined).length / fields.length,
    evidence,
    metrics: [
      { label: 'Market cap', value: m.marketCap === undefined ? null : `$${formatCompact(m.marketCap)}` },
      { label: 'Rank', value: m.rank === undefined ? null : `#${m.rank}` },
      { label: '24h volume', value: m.volume24h === undefined ? null : `$${formatCompact(m.volume24h)}` },
      {
        label: 'Turnover',
        value: m.volume24h !== undefined && m.marketCap ? `${formatNumber((m.volume24h / m.marketCap) * 100, 2)}%` : null,
        hint: '24h volume as a share of market cap',
      },
      { label: 'Circulating supply', value: m.circulatingSupply === undefined ? null : formatCompact(m.circulatingSupply) },
      { label: 'Max supply', value: m.maxSupply === undefined ? null : formatCompact(m.maxSupply) },
      {
        label: 'Supply issued',
        value: m.circulatingSupply !== undefined && m.maxSupply ? `${formatNumber((m.circulatingSupply / m.maxSupply) * 100, 1)}%` : null,
        hint: 'Circulating as a share of maximum supply',
      },
      { label: 'Dominance', value: dominance === undefined ? null : `${formatNumber(dominance, 2)}%`, hint: 'Share of total crypto market cap' },
      { label: 'Volatility (30d)', value: vol === undefined ? null : `${formatNumber(vol, 0)}%`, hint: 'Annualised from daily returns' },
      { label: 'Growth (1y)', value: growth365 === undefined ? null : formatPercent(growth365) },
      { label: 'Growth (90d)', value: growth90 === undefined ? null : formatPercent(growth90) },
    ],
    sources: [m.source, ...(global ? [global.source] : []), ...(series ? [series.source] : [])].filter(
      (v, i, a) => a.indexOf(v) === i,
    ),
  };
}

function scoreFrom(votes: Vote[]): number {
  const total = votes.reduce((sum, v) => sum + v.weight, 0);
  if (total === 0) return 50;
  const weighted = votes.reduce((sum, v) => sum + v.weight * v.vote, 0) / total;
  return clamp(50 + weighted * 50, 0, 100);
}
