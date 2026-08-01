import type { AssetKind } from '@/lib/providers/types';
import { formatCompact, formatNumber } from '@/lib/format';
import type { RiskAssessment, RiskLevel } from './types';

/**
 * Risk classification.
 *
 * Risk here means "how much can this move against you", measured — realised
 * volatility, worst peak-to-trough decline, average true range — not a label
 * attached to an asset class. Bitcoin and a micro-cap biotech both come out as high
 * risk for reasons the drivers list spells out.
 *
 * Returns null when volatility cannot be measured. An unmeasured risk is not "Low
 * Risk"; the caller surfaces it as Insufficient Data.
 */

export interface RiskInput {
  kind: AssetKind;
  /** Annualised, in percent. */
  volatility: number | undefined;
  /** Worst peak-to-trough decline over the available year, in percent. */
  maxDrawdown: number | undefined;
  /** ATR as a percentage of price. */
  atrPercent: number | undefined;
  marketCap: number | undefined;
  /** Bars of history behind the measurements. */
  bars: number;
}

const ORDER: RiskLevel[] = ['Low Risk', 'Medium Risk', 'High Risk', 'Very High Risk'];

function bump(level: RiskLevel, steps = 1): RiskLevel {
  const i = ORDER.indexOf(level);
  return ORDER[Math.min(ORDER.length - 1, i + steps)] as RiskLevel;
}

export function classifyRisk(input: RiskInput): RiskAssessment | null {
  const { volatility, maxDrawdown, atrPercent, marketCap, kind, bars } = input;

  if (volatility === undefined) return null;

  const drivers: string[] = [];

  // Base level from annualised volatility.
  let level: RiskLevel =
    volatility >= 90 ? 'Very High Risk'
    : volatility >= 50 ? 'High Risk'
    : volatility >= 25 ? 'Medium Risk'
    : 'Low Risk';

  drivers.push(
    `Annualised volatility of ${formatNumber(volatility, 0)}% over the last 30 sessions${
      volatility >= 90 ? ' — daily swings of several percent are routine'
      : volatility >= 50 ? ' — well above a typical large-cap equity'
      : volatility >= 25 ? ' — in line with a typical single stock'
      : ' — unusually steady'
    }`,
  );

  // A deep drawdown says the asset has actually delivered the downside its
  // volatility implies, which is different from a quiet year that has not yet.
  if (maxDrawdown !== undefined && maxDrawdown >= 60) {
    level = bump(level);
    drivers.push(`Fell ${formatNumber(maxDrawdown, 0)}% peak-to-trough within the available history`);
  } else if (maxDrawdown !== undefined && maxDrawdown >= 35) {
    drivers.push(`Worst peak-to-trough decline in the available history was ${formatNumber(maxDrawdown, 0)}%`);
  }

  // Size, as a liquidity floor. Thresholds differ by asset class because a $1bn
  // company is a small-cap while a $1bn token is a top-100 asset.
  if (marketCap !== undefined) {
    // Below `floor` an asset leaves the liquid tier for its class; below `deepFloor`
    // position size itself becomes the dominant risk.
    const floor = kind === 'crypto' ? 300e6 : 2e9;
    const deepFloor = kind === 'crypto' ? 100e6 : 300e6;
    if (marketCap < deepFloor) {
      level = bump(level, 2);
      drivers.push(`Capitalisation of $${formatCompact(marketCap)} — exit liquidity is a real constraint`);
    } else if (marketCap < floor) {
      level = bump(level);
      drivers.push(`Capitalisation of $${formatCompact(marketCap)} — below the liquid tier for its asset class`);
    } else {
      drivers.push(`Capitalisation of $${formatCompact(marketCap)} supports orderly entry and exit`);
    }
  }

  if (atrPercent !== undefined) {
    drivers.push(
      `Average true range is ${formatNumber(atrPercent, 1)}% of price — the typical single-day span`,
    );
  }

  // A short history understates risk: the worst has probably not happened yet.
  if (bars < 120) {
    level = bump(level);
    drivers.push(`Only ${bars} daily bars of history — too short to have seen a full drawdown cycle`);
  }

  return {
    level,
    drivers,
    annualisedVolatility: volatility,
    maxDrawdown1y: maxDrawdown ?? null,
    atrPercent: atrPercent ?? null,
  };
}
