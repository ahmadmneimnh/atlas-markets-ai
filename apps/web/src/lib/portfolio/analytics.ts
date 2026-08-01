/**
 * Portfolio analytics.
 *
 * Pure functions over lots and prices. No I/O, no Prisma, no provider calls —
 * which is what makes every number here testable against a worked example rather
 * than eyeballed on a screen.
 *
 * The governing rule is the same one that runs through the rest of Atlas: **a
 * position whose current price is unknown is excluded and reported, never valued
 * at cost.** Valuing at cost is the intuitive fallback and it is quietly
 * catastrophic — it reports an unpriced holding as exactly break-even, so a
 * portfolio full of unpriced assets shows a serene 0.00% return.
 */

export interface Lot {
  quantity: number;
  pricePaid: number;
  fees: number;
  purchasedAt: Date;
}

export interface HoldingInput {
  symbol: string;
  kind: 'equity' | 'crypto';
  /** Sector for equities; category for crypto. Absent when unknown. */
  sector?: string;
  lots: Lot[];
  /** Current price. Undefined when no provider could price it. */
  price?: number;
  /** 0-100 risk score from the engine, when the asset has been scored. */
  riskScore?: number;
}

export interface HoldingValuation {
  symbol: string;
  kind: 'equity' | 'crypto';
  sector?: string;
  quantity: number;
  /** Total paid including fees, divided by quantity. */
  averageCost: number;
  costBasis: number;
  price: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  /** Share of the priced portfolio, 0-1. */
  allocation: number;
  /** Days since the earliest open lot — the holding-period signal. */
  heldDays: number;
  riskScore?: number;
}

export interface UnpricedHolding {
  symbol: string;
  kind: 'equity' | 'crypto';
  quantity: number;
  costBasis: number;
  reason: string;
}

export interface PortfolioSummary {
  holdings: HoldingValuation[];
  /** Positions that could not be valued. Surfaced, never silently dropped. */
  unpriced: UnpricedHolding[];
  totalCostBasis: number;
  totalMarketValue: number;
  totalUnrealizedPnl: number;
  /** Total return on priced holdings only, as a percentage. */
  totalReturnPercent: number;
  diversification: DiversificationScore;
  risk: PortfolioRisk;
  /** Fraction of cost basis that could actually be priced, 0-1. */
  pricedCoverage: number;
}

export interface DiversificationScore {
  /** 0-100. Higher is more diversified. */
  score: number;
  /** Herfindahl-Hirschman Index over position weights, 0-1. */
  hhi: number;
  positions: number;
  sectors: number;
  /** The single largest position's share, 0-1. */
  topWeight: number;
  /** Why the score is what it is, in plain language. */
  notes: string[];
}

export interface PortfolioRisk {
  /** 0-100, weighted mean of holding risk scores. Undefined if none are scored. */
  score?: number;
  /** Share of market value whose risk is actually known, 0-1. */
  coverage: number;
  notes: string[];
}

const DAY_MS = 86_400_000;

/** Total paid for a lot, fees included. Fees are part of cost basis, not a footnote. */
function lotCost(lot: Lot): number {
  return lot.quantity * lot.pricePaid + lot.fees;
}

export function valueHolding(
  holding: HoldingInput,
  now = new Date(),
): { valued?: Omit<HoldingValuation, 'allocation'>; unpriced?: UnpricedHolding } {
  const quantity = holding.lots.reduce((sum, lot) => sum + lot.quantity, 0);
  const costBasis = holding.lots.reduce((sum, lot) => sum + lotCost(lot), 0);

  if (quantity <= 0) {
    return {
      unpriced: {
        symbol: holding.symbol,
        kind: holding.kind,
        quantity,
        costBasis,
        reason: 'Position is fully closed — no open lots remain.',
      },
    };
  }

  if (holding.price === undefined || !Number.isFinite(holding.price)) {
    return {
      unpriced: {
        symbol: holding.symbol,
        kind: holding.kind,
        quantity,
        costBasis,
        reason: 'No configured provider returned a price for this asset.',
      },
    };
  }

  const marketValue = quantity * holding.price;
  const unrealizedPnl = marketValue - costBasis;

  const earliest = holding.lots.reduce(
    (min, lot) => Math.min(min, lot.purchasedAt.getTime()),
    Number.POSITIVE_INFINITY,
  );

  const valued: Omit<HoldingValuation, 'allocation'> = {
    symbol: holding.symbol,
    kind: holding.kind,
    quantity,
    averageCost: costBasis / quantity,
    costBasis,
    price: holding.price,
    marketValue,
    unrealizedPnl,
    // Guarded: a zero cost basis (a gift, an airdrop) would otherwise divide to
    // Infinity and render as a nonsense percentage.
    unrealizedPnlPercent: costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100,
    heldDays: Number.isFinite(earliest) ? Math.floor((now.getTime() - earliest) / DAY_MS) : 0,
  };
  if (holding.sector !== undefined) valued.sector = holding.sector;
  if (holding.riskScore !== undefined) valued.riskScore = holding.riskScore;

  return { valued };
}

/**
 * Diversification, scored from concentration rather than position count.
 *
 * Counting positions is the naive measure and it is easy to game: ten holdings
 * where one is 91% of the book is not a diversified portfolio, but a count says
 * it is. The Herfindahl-Hirschman Index — the sum of squared weights — captures
 * exactly that. HHI of 1 is everything in one position; 1/n is a perfectly even
 * split across n.
 *
 * The score maps HHI onto 0-100 via its "effective number of positions" (1/HHI),
 * which is the interpretable quantity: a portfolio with HHI 0.25 behaves like 4
 * equal positions regardless of how many rows it has.
 */
export function diversification(holdings: HoldingValuation[]): DiversificationScore {
  const notes: string[] = [];

  if (holdings.length === 0) {
    return {
      score: 0,
      hhi: 1,
      positions: 0,
      sectors: 0,
      topWeight: 0,
      notes: ['No priced holdings.'],
    };
  }

  const hhi = holdings.reduce((sum, h) => sum + h.allocation * h.allocation, 0);
  const effectivePositions = hhi > 0 ? 1 / hhi : 0;
  const topWeight = Math.max(...holdings.map((h) => h.allocation));

  const sectors = new Set(holdings.map((h) => h.sector).filter((s): s is string => Boolean(s)));
  const unknownSectors = holdings.filter((h) => !h.sector).length;

  // 10 effective positions is treated as fully diversified for scoring. Beyond
  // that the marginal benefit is small and the score should not keep rewarding
  // it — a 60-position book is not six times better than a 10-position one.
  let score = Math.min(100, (effectivePositions / 10) * 100);

  if (topWeight > 0.5) {
    score *= 0.6;
    notes.push(
      `One position is ${(topWeight * 100).toFixed(0)}% of the portfolio — concentration dominates every other consideration here.`,
    );
  } else if (topWeight > 0.3) {
    score *= 0.85;
    notes.push(`Largest position is ${(topWeight * 100).toFixed(0)}% of the portfolio.`);
  }

  if (sectors.size === 1 && holdings.length > 1) {
    score *= 0.7;
    notes.push(
      `All classified holdings sit in one sector (${[...sectors][0]}); position count does not diversify sector risk.`,
    );
  }

  notes.push(
    `${holdings.length} positions behaving like ${effectivePositions.toFixed(1)} equal-weighted ones.`,
  );

  if (unknownSectors > 0) {
    notes.push(
      `${unknownSectors} holding${unknownSectors === 1 ? '' : 's'} had no sector classification, so sector concentration is measured on the rest.`,
    );
  }

  return {
    score: Math.round(score),
    hhi,
    positions: holdings.length,
    sectors: sectors.size,
    topWeight,
    notes,
  };
}

/**
 * Portfolio risk: the value-weighted mean of holding risk scores.
 *
 * Holdings whose risk is unknown are **excluded from the mean and reported as
 * coverage**, rather than being assumed average. Assuming 50 would drag every
 * portfolio toward the middle and make an unscored book look moderate, which is
 * the same neutral-fill mistake the scoring engine refuses to make.
 */
export function portfolioRisk(holdings: HoldingValuation[]): PortfolioRisk {
  const notes: string[] = [];
  const totalValue = holdings.reduce((sum, h) => sum + h.marketValue, 0);

  if (totalValue === 0) {
    return { coverage: 0, notes: ['No priced holdings to assess.'] };
  }

  const scored = holdings.filter((h) => h.riskScore !== undefined);
  const scoredValue = scored.reduce((sum, h) => sum + h.marketValue, 0);
  const coverage = scoredValue / totalValue;

  if (scored.length === 0) {
    return {
      coverage: 0,
      notes: ['No holding has a risk score yet, so no portfolio risk is reported.'],
    };
  }

  const weighted = scored.reduce((sum, h) => sum + h.riskScore! * h.marketValue, 0) / scoredValue;

  if (coverage < 0.75) {
    notes.push(
      `Risk is measured across ${(coverage * 100).toFixed(0)}% of portfolio value; the rest is unscored and excluded rather than assumed average.`,
    );
  }

  const concentrated = holdings.filter((h) => h.allocation > 0.25 && (h.riskScore ?? 0) > 60);
  for (const holding of concentrated) {
    notes.push(
      `${holding.symbol} is ${(holding.allocation * 100).toFixed(0)}% of the book and carries a high individual risk score.`,
    );
  }

  return { score: Math.round(weighted), coverage, notes };
}

export function summarise(holdings: HoldingInput[], now = new Date()): PortfolioSummary {
  const valued: Omit<HoldingValuation, 'allocation'>[] = [];
  const unpriced: UnpricedHolding[] = [];

  for (const holding of holdings) {
    const result = valueHolding(holding, now);
    if (result.valued) valued.push(result.valued);
    if (result.unpriced) unpriced.push(result.unpriced);
  }

  const totalMarketValue = valued.reduce((sum, h) => sum + h.marketValue, 0);

  // Allocation is a share of the *priced* portfolio. Including unpriced cost
  // basis in the denominator would make every weight quietly wrong, and the
  // weights feed both diversification and risk.
  const withAllocation: HoldingValuation[] = valued.map((h) => ({
    ...h,
    allocation: totalMarketValue === 0 ? 0 : h.marketValue / totalMarketValue,
  }));

  const pricedCost = valued.reduce((sum, h) => sum + h.costBasis, 0);
  const unpricedCost = unpriced.reduce((sum, h) => sum + h.costBasis, 0);
  const totalCost = pricedCost + unpricedCost;

  return {
    holdings: withAllocation.sort((a, b) => b.marketValue - a.marketValue),
    unpriced,
    totalCostBasis: totalCost,
    totalMarketValue,
    totalUnrealizedPnl: totalMarketValue - pricedCost,
    totalReturnPercent: pricedCost === 0 ? 0 : ((totalMarketValue - pricedCost) / pricedCost) * 100,
    diversification: diversification(withAllocation),
    risk: portfolioRisk(withAllocation),
    pricedCoverage: totalCost === 0 ? 0 : pricedCost / totalCost,
  };
}
