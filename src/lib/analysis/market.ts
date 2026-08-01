import { cached, cacheKey, TTL } from '@/lib/cache';
import { market as providers } from '@/lib/providers/registry';
import { env } from '@/lib/env';
import { EQUITY_UNIVERSE, CRYPTO_UNIVERSE } from '@/lib/universe';
import { formatNumber, formatPercent } from '@/lib/format';
import type { AssetKind, CryptoGlobal, Quote } from '@/lib/providers/types';
import type { UnavailableDTO } from '@/lib/dto';
import { ema, momentum, trendDirection } from './indicators';
import { clamp } from './technical';
import {
  moduleUnavailable, reason, warning,
  type Evidence, type Metric, type ModuleResult,
} from './types';

/**
 * Market conditions.
 *
 * Two halves: `buildMarketContext` does the I/O once per 30 minutes and is shared by
 * every asset page and by the scanner; `analyseMarket` is a pure function of that
 * context. Recomputing the regime per asset would turn one benchmark read into
 * twenty, which on a 25-request-a-day free tier is the difference between working
 * and not.
 */

export type RegimeLabel = 'Bullish' | 'Bearish' | 'Neutral';

export interface Breadth {
  above: number;
  total: number;
}

export interface MarketRegime {
  label: RegimeLabel;
  /** 0–100, 50 neutral. */
  score: number;
  /** Measured statements, each one a fact with a number in it. */
  basis: string[];
  breadth: Breadth | null;
  completeness: number;
  sources: string[];
}

export interface SectorStrength {
  name: string;
  members: number;
  /** Mean of members' latest change, in percent. */
  averageChange: number;
  /** Difference from the mean across all tracked stocks, in percentage points. */
  vsMarket: number;
}

export interface MarketContext {
  crypto: MarketRegime | null;
  cryptoUnavailable: UnavailableDTO | null;
  equity: MarketRegime | null;
  equityUnavailable: UnavailableDTO | null;
  sectors: SectorStrength[];
  sectorsUnavailable: UnavailableDTO | null;
  global: CryptoGlobal | null;
  asOf: string;
}

/** Index proxy for the stock-market regime. Configurable; empty disables the read. */
const EQUITY_BENCHMARK = (process.env['BB_MARKET_BENCHMARK'] ?? 'SPY').trim();

// ── Context assembly (I/O) ──────────────────────────────────────────────────────

export async function buildMarketContext(): Promise<MarketContext> {
  return cached(cacheKey('market-context'), TTL.marketContext, computeMarketContext);
}

async function computeMarketContext(): Promise<MarketContext> {
  const [crypto, equity, sectors, globalResult] = await Promise.all([
    cryptoRegime(),
    equityRegime(),
    sectorStrength(),
    providers.cryptoGlobal(),
  ]);

  return {
    crypto: crypto.regime,
    cryptoUnavailable: crypto.unavailable,
    equity: equity.regime,
    equityUnavailable: equity.unavailable,
    sectors: sectors.sectors,
    sectorsUnavailable: sectors.unavailable,
    global: globalResult.ok ? globalResult.data : null,
    asOf: new Date().toISOString(),
  };
}

type RegimeOutcome = { regime: MarketRegime | null; unavailable: UnavailableDTO | null };

/**
 * Crypto regime: Bitcoin's own trend plus how much of the tracked list is
 * participating. Bitcoin alone can rise while everything else bleeds, which is a
 * materially different market from one where breadth confirms.
 */
async function cryptoRegime(): Promise<RegimeOutcome> {
  const [btc, global, breadth] = await Promise.all([
    providers.ohlcv('BTC', 'crypto', '1d', 365),
    providers.cryptoGlobal(),
    breadthOf(CRYPTO_UNIVERSE.map((u) => u.symbol), 'crypto'),
  ]);

  if (!btc.ok && !global.ok && breadth === null) {
    return {
      regime: null,
      unavailable: btc.ok ? { reason: 'upstream_error' } : { reason: btc.reason, ...(btc.detail ? { detail: btc.detail } : {}) },
    };
  }

  const votes: number[] = [];
  const basis: string[] = [];
  const sources: string[] = [];
  let parts = 0;
  const possible = 3;

  if (btc.ok) {
    parts++;
    sources.push(btc.data.source);
    const closes = btc.data.candles.map((c) => c.close);
    const trend = trendDirection(closes);
    const mom30 = momentum(closes, 30);
    const price = closes[closes.length - 1] as number;
    const e200 = ema(closes, 200);

    if (trend) {
      const map: Record<string, number> = {
        strong_uptrend: 1, uptrend: 0.5, sideways: 0, downtrend: -0.5, strong_downtrend: -1,
      };
      votes.push(map[trend.direction] ?? 0);
      basis.push(`Bitcoin is in a ${trend.direction.replace('_', ' ')} (${trend.basis})`);
    }
    if (e200 !== undefined) {
      votes.push(price > e200 ? 0.6 : -0.6);
    }
    if (mom30 !== undefined) {
      votes.push(clamp(mom30 / 25, -1, 1));
      basis.push(`Bitcoin ${mom30 >= 0 ? 'up' : 'down'} ${formatPercent(Math.abs(mom30))} over 30 sessions`);
    }
  }

  if (breadth) {
    parts++;
    const share = breadth.above / breadth.total;
    votes.push((share - 0.5) * 2);
    basis.push(`${breadth.above} of ${breadth.total} tracked coins are above their 50-day EMA`);
  }

  if (global.ok) {
    parts++;
    sources.push(global.data.source);
    votes.push(clamp(global.data.marketCapChange24h / 6, -1, 1));
    basis.push(
      `Total crypto market cap ${global.data.marketCapChange24h >= 0 ? 'up' : 'down'} ${formatPercent(Math.abs(global.data.marketCapChange24h))} in 24h; Bitcoin dominance ${formatNumber(global.data.btcDominance, 1)}%`,
    );
  }

  if (votes.length === 0) {
    return { regime: null, unavailable: { reason: 'not_found', detail: 'no crypto market inputs were available' } };
  }

  return {
    regime: regimeFrom(votes, basis, breadth, parts / possible, sources),
    unavailable: null,
  };
}

/**
 * Equity regime: an index proxy where one is affordable, plus breadth across the
 * tracked list. Breadth alone still works when no equity history provider is
 * configured — it comes from quotes that the dashboard already fetched.
 */
async function equityRegime(): Promise<RegimeOutcome> {
  if (!env.providers.finnhub) {
    return {
      regime: null,
      unavailable: {
        reason: 'no_provider_configured',
        detail: 'stock market conditions need a stock quote provider (FINNHUB_API_KEY)',
      },
    };
  }

  const wantsBenchmark = EQUITY_BENCHMARK.length > 0 && Boolean(env.providers.alphaVantage);

  const [benchmark, quotes] = await Promise.all([
    wantsBenchmark
      ? providers.ohlcv(EQUITY_BENCHMARK, 'equity', '1d', 365)
      : Promise.resolve(null),
    providers.quotes(EQUITY_UNIVERSE.map((u) => ({ symbol: u.symbol, kind: 'equity' as const }))),
  ]);

  const votes: number[] = [];
  const basis: string[] = [];
  const sources: string[] = [];
  let parts = 0;
  const possible = 2;

  if (benchmark?.ok) {
    parts++;
    sources.push(benchmark.data.source);
    const closes = benchmark.data.candles.map((c) => c.close);
    const trend = trendDirection(closes);
    const mom30 = momentum(closes, 30);
    if (trend) {
      const map: Record<string, number> = {
        strong_uptrend: 1, uptrend: 0.5, sideways: 0, downtrend: -0.5, strong_downtrend: -1,
      };
      votes.push(map[trend.direction] ?? 0);
      basis.push(`${EQUITY_BENCHMARK} is in a ${trend.direction.replace('_', ' ')} (${trend.basis})`);
    }
    if (mom30 !== undefined) {
      votes.push(clamp(mom30 / 8, -1, 1));
      basis.push(`${EQUITY_BENCHMARK} ${mom30 >= 0 ? 'up' : 'down'} ${formatPercent(Math.abs(mom30))} over 30 sessions`);
    }
  }

  const priced = quotes.filter((q) => q.result.ok);
  let breadth: Breadth | null = null;
  if (priced.length >= 5) {
    parts++;
    const advancing = priced.filter((q) => (q.result.ok ? q.result.data.changePercent : 0) > 0).length;
    breadth = { above: advancing, total: priced.length };
    votes.push((advancing / priced.length - 0.5) * 2);

    const avg =
      priced.reduce((sum, q) => sum + (q.result.ok ? q.result.data.changePercent : 0), 0) / priced.length;
    votes.push(clamp(avg / 1.5, -1, 1));
    basis.push(
      `${advancing} of ${priced.length} tracked stocks are advancing today, averaging ${formatPercent(avg)}`,
    );
    const first = priced[0];
    if (first && first.result.ok) sources.push(first.result.data.source);
  }

  if (votes.length === 0) {
    return {
      regime: null,
      unavailable: { reason: 'not_found', detail: 'no stock quotes were available to measure breadth' },
    };
  }

  return { regime: regimeFrom(votes, basis, breadth, parts / possible, sources), unavailable: null };
}

/** Share of a list trading above its own 50-day EMA. Null when nothing resolved. */
async function breadthOf(symbols: string[], kind: AssetKind): Promise<Breadth | null> {
  const series = await Promise.all(symbols.map((s) => providers.ohlcv(s, kind, '1d', 365)));

  let above = 0;
  let total = 0;
  for (const r of series) {
    if (!r.ok) continue;
    const closes = r.data.candles.map((c) => c.close);
    const e50 = ema(closes, 50);
    const price = closes[closes.length - 1];
    if (e50 === undefined || price === undefined) continue;
    total++;
    if (price > e50) above++;
  }

  return total >= 3 ? { above, total } : null;
}

/**
 * Sector strength across the tracked stock list.
 *
 * A sector needs at least three members before its average means anything — with one
 * member, "sector outperforming" is just that company's day restated as a trend.
 */
async function sectorStrength(): Promise<{ sectors: SectorStrength[]; unavailable: UnavailableDTO | null }> {
  if (!env.providers.finnhub) {
    return {
      sectors: [],
      unavailable: { reason: 'no_provider_configured', detail: 'sector grouping needs company profiles (FINNHUB_API_KEY)' },
    };
  }

  const entries = await Promise.all(
    EQUITY_UNIVERSE.map(async (u) => {
      const [profile, quote] = await Promise.all([
        providers.profile(u.symbol),
        providers.quote(u.symbol, 'equity'),
      ]);
      if (!profile.ok || !quote.ok) return null;
      const sector = profile.data.sector ?? profile.data.industry;
      if (!sector) return null;
      return { sector, quote: quote.data as Quote };
    }),
  );

  const usable = entries.filter((e): e is { sector: string; quote: Quote } => e !== null);
  if (usable.length < 3) {
    return {
      sectors: [],
      unavailable: { reason: 'not_found', detail: 'too few stock profiles resolved to group into sectors' },
    };
  }

  const marketAverage = usable.reduce((sum, e) => sum + e.quote.changePercent, 0) / usable.length;

  const groups = new Map<string, number[]>();
  for (const e of usable) {
    const list = groups.get(e.sector) ?? [];
    list.push(e.quote.changePercent);
    groups.set(e.sector, list);
  }

  const sectors: SectorStrength[] = [];
  for (const [name, changes] of groups) {
    if (changes.length < 3) continue;
    const averageChange = changes.reduce((a, b) => a + b, 0) / changes.length;
    sectors.push({
      name,
      members: changes.length,
      averageChange,
      vsMarket: averageChange - marketAverage,
    });
  }
  sectors.sort((a, b) => b.averageChange - a.averageChange);

  if (sectors.length === 0) {
    return {
      sectors: [],
      unavailable: {
        reason: 'not_found',
        detail: 'no sector in the tracked list has the three members needed for an average to be meaningful',
      },
    };
  }
  return { sectors, unavailable: null };
}

function regimeFrom(
  votes: number[],
  basis: string[],
  breadth: Breadth | null,
  completeness: number,
  sources: string[],
): MarketRegime {
  const mean = votes.reduce((a, b) => a + b, 0) / votes.length;
  const score = clamp(50 + mean * 50, 0, 100);
  return {
    label: score >= 60 ? 'Bullish' : score <= 40 ? 'Bearish' : 'Neutral',
    score,
    basis,
    breadth,
    completeness: clamp(completeness, 0, 1),
    sources: sources.filter((v, i, a) => a.indexOf(v) === i),
  };
}

// ── Scoring (pure) ──────────────────────────────────────────────────────────────

/**
 * Scores an asset's environment: its asset class's regime, plus its sector's
 * strength when the asset is a stock and its sector has enough members.
 */
export function analyseMarket(
  kind: AssetKind,
  context: MarketContext,
  sectorName?: string,
): ModuleResult {
  const label = 'Market conditions';
  const regime = kind === 'crypto' ? context.crypto : context.equity;
  const unavailable = kind === 'crypto' ? context.cryptoUnavailable : context.equityUnavailable;

  if (!regime) {
    return moduleUnavailable(
      'market',
      label,
      unavailable?.reason ?? 'not_found',
      unavailable?.detail ?? 'market conditions could not be measured',
    );
  }

  const evidence: Evidence[] = [];
  const votes: number[] = [(regime.score - 50) / 50];

  const regimeDirection = regime.label === 'Bullish' ? 'bullish' : regime.label === 'Bearish' ? 'bearish' : 'neutral';
  const headline = `${kind === 'crypto' ? 'Crypto market' : 'Stock market'} regime is ${regime.label}`;
  const detail = regime.basis[0] ? `: ${regime.basis[0]}` : '';

  evidence.push(
    regimeDirection === 'bearish'
      ? warning('market', `${headline}${detail}`, 'high')
      : reason('market', `${headline}${detail}`, regimeDirection, regimeDirection === 'neutral' ? 'low' : 'high'),
  );

  for (const line of regime.basis.slice(1)) {
    evidence.push(reason('market', line, regimeDirection, 'low'));
  }

  // Sector, for stocks only.
  const sector = sectorName ? context.sectors.find((s) => s.name === sectorName) : undefined;
  if (sector) {
    votes.push(clamp(sector.vsMarket / 1.5, -1, 1));
    if (sector.vsMarket > 0.2) {
      evidence.push(
        reason(
          'market',
          `${sector.name} is outperforming the tracked market by ${formatNumber(sector.vsMarket, 2)} points today (${sector.members} members)`,
          'bullish',
          'medium',
        ),
      );
    } else if (sector.vsMarket < -0.2) {
      evidence.push(
        warning(
          'market',
          `${sector.name} is lagging the tracked market by ${formatNumber(Math.abs(sector.vsMarket), 2)} points today (${sector.members} members)`,
          'medium',
        ),
      );
    }
  } else if (kind === 'equity' && context.sectorsUnavailable) {
    evidence.push(
      reason('market', `Sector strength unavailable — ${context.sectorsUnavailable.detail ?? 'not measurable'}`, 'neutral', 'low'),
    );
  }

  const mean = votes.reduce((a, b) => a + b, 0) / votes.length;

  const metrics: Metric[] = [
    { label: 'Regime', value: regime.label, hint: regime.basis[0] ?? undefined, direction: regimeDirection },
    {
      label: 'Breadth',
      value: regime.breadth ? `${regime.breadth.above} / ${regime.breadth.total}` : null,
      hint: kind === 'crypto' ? 'Tracked coins above their 50-day EMA' : 'Tracked stocks advancing today',
    },
    {
      label: 'Sector',
      value: sector ? `${sector.name} ${formatPercent(sector.averageChange)}` : null,
      hint: sector ? `${sector.members} tracked members, ${formatNumber(sector.vsMarket, 2)} pts vs market` : context.sectorsUnavailable?.detail,
    },
  ];

  if (kind === 'crypto' && context.global) {
    metrics.push({
      label: 'BTC dominance',
      value: `${formatNumber(context.global.btcDominance, 1)}%`,
      hint: 'Bitcoin share of total crypto market cap',
    });
    metrics.push({
      label: 'Total crypto cap 24h',
      value: formatPercent(context.global.marketCapChange24h),
      direction: context.global.marketCapChange24h >= 0 ? 'bullish' : 'bearish',
    });
  }

  return {
    id: 'market',
    label,
    available: true,
    score: clamp(50 + mean * 50, 0, 100),
    completeness: regime.completeness,
    evidence,
    metrics,
    sources: regime.sources,
  };
}
