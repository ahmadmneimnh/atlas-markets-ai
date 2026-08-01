import { cached, cacheKey, TTL } from '@/lib/cache';
import { market as providers } from '@/lib/providers/registry';
import type { AssetKind, NewsArticle, OhlcvSeries } from '@/lib/providers/types';
import { findAsset } from '@/lib/universe';
import { analyseTechnical, snapshot, type TechnicalSnapshot } from './technical';
import { analyseCryptoFundamentals, analyseEquityFundamentals } from './fundamental';
import { analyseMarket, buildMarketContext, type MarketContext } from './market';
import { analyseSentiment } from './sentiment';
import { classifyRisk } from './risk';
import { deriveLevels } from './levels';
import { collectEvidence, deriveHorizon, scoreModules } from './scoring';
import { moduleUnavailable, type AnalysisResult, type ModuleResult } from './types';

/**
 * The orchestrator: fetch what each module needs, run the modules, score them.
 *
 * All the analysis lives in the modules; this file only decides what to fetch and in
 * what order, so adding a module means adding a file and one entry here rather than
 * editing a monolith.
 *
 * Everything is fetched concurrently and every fetch is allowed to fail: a failure
 * becomes an unavailable module with a reason, never a zero.
 */

export interface AssetTarget {
  symbol: string;
  kind: AssetKind;
  name?: string;
}

/** Cached analysis. The TTL is short because the technicals move with the price. */
export async function analyseAsset(target: AssetTarget, context?: MarketContext): Promise<AnalysisResult> {
  const symbol = target.symbol.toUpperCase();
  // A caller-supplied context is already shared and cached upstream (the scanner
  // builds one for the whole run), so it is not part of the key.
  return cached(cacheKey('analysis', target.kind, symbol), TTL.analysis, () =>
    computeAnalysis({ ...target, symbol }, context),
  );
}

async function computeAnalysis(target: AssetTarget, context?: MarketContext): Promise<AnalysisResult> {
  const { symbol, kind } = target;
  const known = findAsset(symbol, kind);
  const name = target.name ?? known?.name ?? symbol;

  const [ctx, quote, ohlcv, fundamentals, metrics, profile, news] = await Promise.all([
    context ? Promise.resolve(context) : buildMarketContext(),
    providers.quote(symbol, kind),
    providers.ohlcv(symbol, kind, '1d', 365),
    kind === 'equity' ? providers.fundamentals(symbol) : Promise.resolve(null),
    kind === 'crypto' ? providers.cryptoMetrics(symbol) : Promise.resolve(null),
    kind === 'equity' ? providers.profile(symbol) : Promise.resolve(null),
    kind === 'equity' ? providers.news(symbol, 25) : Promise.resolve(null),
  ]);

  const series: OhlcvSeries | null = ohlcv.ok ? ohlcv.data : null;
  const snap: TechnicalSnapshot | undefined = series ? snapshot(series) : undefined;

  // ── Modules ───────────────────────────────────────────────────────────────────

  const technical = analyseTechnical(
    series,
    ohlcv.ok ? undefined : { reason: ohlcv.reason, ...(ohlcv.detail ? { detail: ohlcv.detail } : {}) },
  );

  const fundamental: ModuleResult =
    kind === 'equity'
      ? analyseEquityFundamentals(
          fundamentals?.ok ? fundamentals.data : null,
          fundamentals && !fundamentals.ok
            ? { reason: fundamentals.reason, ...(fundamentals.detail ? { detail: fundamentals.detail } : {}) }
            : undefined,
        )
      : analyseCryptoFundamentals(
          metrics?.ok ? metrics.data : null,
          ctx.global,
          series,
          metrics && !metrics.ok
            ? { reason: metrics.reason, ...(metrics.detail ? { detail: metrics.detail } : {}) }
            : undefined,
        );

  const sectorName = profile?.ok ? (profile.data.sector ?? profile.data.industry) : undefined;
  const marketModule = analyseMarket(kind, ctx, sectorName);

  const sentiment: ModuleResult =
    kind === 'equity'
      ? analyseSentiment(
          news?.ok ? articlesOf(news.data) : null,
          news && !news.ok
            ? { reason: news.reason, ...(news.detail ? { detail: news.detail } : {}) }
            : undefined,
        )
      : moduleUnavailable(
          'sentiment',
          'News sentiment',
          'not_supported',
          'no configured news provider covers cryptocurrency — Finnhub company-news is filed against stock tickers only',
        );

  const modules: ModuleResult[] = [technical, fundamental, marketModule, sentiment];

  // ── Verdict ───────────────────────────────────────────────────────────────────

  const price = quote.ok ? quote.data.price : (snap?.price ?? null);
  if (price === null) {
    return {
      symbol, kind, name, available: false,
      unavailable: {
        reason: quote.ok ? 'not_found' : quote.reason,
        detail: `no current price could be obtained${quote.ok ? '' : ` — ${quote.detail ?? quote.reason}`}`,
      },
      modules,
    };
  }

  const outcome = scoreModules(modules);
  if (!outcome) {
    const missing = modules
      .filter((m) => !m.available)
      .map((m) => `${m.label}: ${m.available ? '' : (m.unavailable.detail ?? m.unavailable.reason)}`);
    return {
      symbol, kind, name, available: false,
      unavailable: {
        reason: 'not_found',
        detail: `too little of the weighting could be evaluated to issue a verdict — ${missing.join('; ')}`,
      },
      modules,
    };
  }

  const risk = snap
    ? classifyRisk({
        kind,
        volatility: snap.volatility30,
        maxDrawdown: snap.maxDrawdown1y,
        atrPercent: snap.atrPercent,
        marketCap: marketCapOf(fundamentals, metrics),
        bars: snap.bars,
      })
    : null;

  const levels = snap
    ? deriveLevels({ price, atr: snap.atr14, support: snap.support, resistance: snap.resistance })
    : null;

  const fundamentalScore = fundamental.available ? fundamental.score : null;
  const { horizon, reason: horizonReason } = deriveHorizon({
    kind,
    volatility: snap?.volatility30,
    adx: snap?.adx14?.adx,
    trend: snap?.trend?.direction,
    fundamentalScore,
    aboveEma200: snap?.ema200 === undefined ? undefined : price > snap.ema200,
  });

  const { reasons, warnings } = collectEvidence(modules);

  const sources = [
    ...(quote.ok ? [quote.data.source] : []),
    ...modules.flatMap((m) => (m.available ? m.sources : [])),
  ].filter((v, i, a) => a.indexOf(v) === i);

  return {
    available: true,
    symbol,
    kind,
    name,
    price,
    currency: quote.ok ? (quote.data.currency ?? 'USD') : 'USD',

    verdict: outcome.verdict,
    action: outcome.action,
    conviction: outcome.conviction,
    probabilities: outcome.probabilities,
    confidence: outcome.confidence,
    confidenceScore: outcome.confidenceScore,
    horizon,
    horizonReason,

    risk,
    riskUnavailable: risk
      ? null
      : {
          reason: series ? 'not_found' : (ohlcv.ok ? 'not_found' : ohlcv.reason),
          detail: series
            ? 'price history was too short to measure 30-day volatility'
            : 'risk is measured from price history, which is unavailable for this asset',
        },
    levels,
    levelsUnavailable: levels
      ? null
      : {
          reason: series ? 'not_found' : (ohlcv.ok ? 'not_found' : ohlcv.reason),
          detail: series
            ? 'price history was too short to measure an average true range'
            : 'entry, stop and target are derived from price history, which is unavailable',
        },

    modules,
    weights: outcome.weights,
    reasons,
    warnings,
    summary: outcome.summary,

    asOf: new Date().toISOString(),
    sources,
  };
}

function articlesOf(news: NewsArticle[]): NewsArticle[] {
  // Dates arrive as Date objects from the adapter; guard against a cached shape that
  // has been through JSON at some point.
  return news.map((a) => ({ ...a, publishedAt: new Date(a.publishedAt) }));
}

function marketCapOf(
  fundamentals: Awaited<ReturnType<typeof providers.fundamentals>> | null,
  metrics: Awaited<ReturnType<typeof providers.cryptoMetrics>> | null,
): number | undefined {
  if (fundamentals?.ok) return fundamentals.data.marketCap;
  if (metrics?.ok) return metrics.data.marketCap;
  return undefined;
}

export { buildMarketContext };
export type { MarketContext };
