import { cached, cacheKey, TTL } from '@/lib/cache';
import type { UnavailableDTO } from '@/lib/dto';
import { trackedUniverse } from '@/lib/universe';
import type { AssetKind } from '@/lib/providers/types';
import { analyseAsset, buildMarketContext } from './engine';
import type { AnalysisResult, Recommendation } from './types';
import type { MarketContext } from './market';
import { snapshot } from './technical';

/**
 * Market scanner.
 *
 * Runs the same engine over every tracked asset and ranks the results. Two things
 * keep it inside free-tier quotas: the market context is built once and passed to
 * every asset rather than rebuilt per asset, and the whole scan is cached — the
 * per-provider rate limiters underneath do the rest.
 *
 * Assets that could not be analysed are listed with their reason instead of being
 * dropped. A scanner that silently omits what it could not read tells you the
 * market is quiet when in fact you are out of quota.
 */

export interface ScanEntry {
  symbol: string;
  name: string;
  kind: AssetKind;
  price: number;
  conviction: number;
  verdict: Recommendation['verdict'];
  action: Recommendation['action'];
  probabilities: Recommendation['probabilities'];
  confidence: Recommendation['confidence'];
  risk: Recommendation['risk'];
  /** 20-session price change, percent — the momentum ranking. */
  momentum20: number | null;
  /** ADX(14): how committed the trend is. */
  adx: number | null;
  /** RSI(14), used to spot reversals off an extreme. */
  rsi: number | null;
  /** True when a fresh MACD crossover or an RSI exit from an extreme is present. */
  reversal: { direction: 'bullish' | 'bearish'; note: string } | null;
  /** The single strongest piece of evidence, for the row's one-line summary. */
  headline: string;
}

export interface ScanSkip {
  symbol: string;
  name: string;
  kind: AssetKind;
  unavailable: UnavailableDTO;
}

export interface ScanResult {
  entries: ScanEntry[];
  skipped: ScanSkip[];
  topBuys: ScanEntry[];
  topHolds: ScanEntry[];
  topSells: ScanEntry[];
  strongestMomentum: ScanEntry[];
  strongestReversals: ScanEntry[];
  context: MarketContext;
  scannedAt: string;
}

/** How many assets are analysed at once. Keeps provider bursts bounded. */
const CONCURRENCY = 4;

export async function scanMarket(): Promise<ScanResult> {
  return cached(cacheKey('scan'), TTL.analysis, computeScan);
}

async function computeScan(): Promise<ScanResult> {
  const universe = trackedUniverse();
  const context = await buildMarketContext();

  const results: AnalysisResult[] = [];
  for (let i = 0; i < universe.length; i += CONCURRENCY) {
    const batch = universe.slice(i, i + CONCURRENCY);
    const analysed = await Promise.all(
      batch.map((u) => analyseAsset({ symbol: u.symbol, kind: u.kind, name: u.name }, context)),
    );
    results.push(...analysed);
  }

  const entries: ScanEntry[] = [];
  const skipped: ScanSkip[] = [];

  for (const r of results) {
    if (!r.available) {
      skipped.push({ symbol: r.symbol, name: r.name, kind: r.kind, unavailable: r.unavailable });
      continue;
    }
    entries.push(toEntry(r));
  }

  const byConviction = [...entries].sort((a, b) => b.conviction - a.conviction);

  return {
    entries: byConviction,
    skipped,
    topBuys: byConviction.filter((e) => e.action === 'BUY').slice(0, 6),
    // Holds are ranked by how settled they are — closest to neutral first, since a
    // Hold at 57 is a near-miss Buy rather than a stable position.
    topHolds: entries
      .filter((e) => e.action === 'HOLD')
      .sort((a, b) => Math.abs(a.conviction - 50) - Math.abs(b.conviction - 50))
      .slice(0, 6),
    topSells: [...byConviction].reverse().filter((e) => e.action === 'SELL').slice(0, 6),
    strongestMomentum: entries
      .filter((e) => e.momentum20 !== null)
      .sort((a, b) => (b.momentum20 as number) - (a.momentum20 as number))
      .slice(0, 6),
    strongestReversals: entries
      .filter((e) => e.reversal !== null)
      .sort((a, b) => reversalRank(b) - reversalRank(a))
      .slice(0, 6),
    context,
    scannedAt: new Date().toISOString(),
  };
}

/** Bullish reversals rank above bearish ones, then by how extreme the RSI was. */
function reversalRank(e: ScanEntry): number {
  const base = e.reversal?.direction === 'bullish' ? 100 : 0;
  const extremity = e.rsi === null ? 0 : Math.abs(50 - e.rsi);
  return base + extremity;
}

function toEntry(r: Extract<AnalysisResult, { available: true }>): ScanEntry {
  const technical = r.modules.find((m) => m.id === 'technical');
  const metrics = technical?.available ? technical.metrics : [];

  const num = (label: string): number | null => {
    const raw = metrics.find((m) => m.label === label)?.value;
    if (!raw) return null;
    const parsed = Number(raw.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const momentum20 = num('20-day momentum');
  const rsi = num('RSI (14)');
  const adx = num('ADX (14)');

  return {
    symbol: r.symbol,
    name: r.name,
    kind: r.kind,
    price: r.price,
    conviction: r.conviction,
    verdict: r.verdict,
    action: r.action,
    probabilities: r.probabilities,
    confidence: r.confidence,
    risk: r.risk,
    momentum20,
    adx,
    rsi,
    reversal: detectReversal(r),
    headline: r.reasons[0]?.text ?? r.summary,
  };
}

/**
 * A reversal is a turn that has just happened, not a level that looks stretched:
 * a MACD crossover on the latest bar, or RSI leaving an extreme. Both are read off
 * the evidence the technical module already produced, so the scanner and the asset
 * page can never disagree about whether one occurred.
 */
function detectReversal(r: Extract<AnalysisResult, { available: true }>): ScanEntry['reversal'] {
  const evidence = r.modules.flatMap((m) => (m.available ? m.evidence : []));

  const bullishCross = evidence.find((e) => e.text.includes('MACD bullish crossover'));
  if (bullishCross) return { direction: 'bullish', note: 'MACD crossed above its signal line on the latest bar' };

  const bearishCross = evidence.find((e) => e.text.includes('MACD bearish crossover'));
  if (bearishCross) return { direction: 'bearish', note: 'MACD crossed below its signal line on the latest bar' };

  const golden = evidence.find((e) => e.text.startsWith('Golden cross'));
  if (golden) return { direction: 'bullish', note: '50-day SMA crossed above the 200-day' };

  const death = evidence.find((e) => e.text.startsWith('Death cross'));
  if (death) return { direction: 'bearish', note: '50-day SMA crossed below the 200-day' };

  const oversold = evidence.find((e) => e.text.includes('oversold'));
  if (oversold) return { direction: 'bullish', note: 'RSI in oversold territory' };

  return null;
}

export { snapshot };
