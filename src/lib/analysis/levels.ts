import { formatNumber, formatPrice } from '@/lib/format';
import type { TradeLevels } from './types';

/**
 * Entry, stop and target levels.
 *
 * These are derived from two measured things — the average true range and the pivot
 * levels in the price history — and nothing else. They are not forecasts: the target
 * is where the nearest resistance sits or where a 2:1 reward-to-risk lands, and the
 * stop is below the structure that would invalidate a long thesis. The `basis`
 * string travels with them so the screen can say exactly how each number was
 * reached.
 *
 * Levels are always framed for the long side. For a Sell verdict they mark where a
 * long would become valid again and where it would be wrong, which is the same
 * arithmetic viewed from the other side.
 */

export interface LevelInput {
  price: number;
  atr: number | undefined;
  /** Pivot lows below price, nearest last. */
  support: number[];
  /** Pivot highs above price, nearest first. */
  resistance: number[];
}

export function deriveLevels(input: LevelInput): TradeLevels | null {
  const { price, atr, support, resistance } = input;
  if (!Number.isFinite(price) || price <= 0 || atr === undefined || atr <= 0) return null;

  const nearestSupport = support[support.length - 1];
  const nearestResistance = resistance[0];

  const parts: string[] = [`ATR(14) = ${formatPrice(atr)}`];

  // Entry: a band around the current price, extended down to the nearest support
  // when that support is close enough to be the actual decision point.
  let entryLow = price - 0.5 * atr;
  const entryHigh = price + 0.25 * atr;
  if (nearestSupport !== undefined && nearestSupport < price && price - nearestSupport <= 2.5 * atr) {
    entryLow = Math.min(entryLow, nearestSupport);
    parts.push(`entry extended to pivot support at ${formatPrice(nearestSupport)}`);
  } else {
    parts.push('entry is price ±½ ATR — no pivot support within 2.5 ATR');
  }

  // Stop: below the structure, not at a round number. Half an ATR of clearance keeps
  // ordinary daily noise from taking the position out.
  let stopLoss: number;
  if (nearestSupport !== undefined && nearestSupport < entryLow) {
    stopLoss = nearestSupport - 0.5 * atr;
    parts.push(`stop ½ ATR below that support`);
  } else {
    stopLoss = entryLow - 1.5 * atr;
    parts.push('stop 1.5 ATR below the entry band');
  }
  if (stopLoss <= 0) stopLoss = Math.max(price * 0.5, price - 2 * atr);

  const risk = entryHigh - stopLoss;
  if (risk <= 0) return null;

  // Target: the nearest resistance if it pays at least 1.5:1, otherwise a 2:1 level.
  let target: number;
  if (nearestResistance !== undefined && nearestResistance - entryHigh >= 1.5 * risk) {
    target = nearestResistance;
    parts.push(`target at pivot resistance ${formatPrice(nearestResistance)}`);
  } else {
    target = entryHigh + 2 * risk;
    parts.push(
      nearestResistance === undefined
        ? 'target at 2:1 reward-to-risk — no pivot resistance overhead'
        : `target at 2:1 reward-to-risk; the nearest resistance (${formatPrice(nearestResistance)}) is too close to pay for the risk`,
    );
  }

  const rewardRisk = (target - entryHigh) / risk;

  return {
    entryLow,
    entryHigh,
    stopLoss,
    target,
    rewardRisk,
    basis: `${parts.join('; ')}. Reward-to-risk ${formatNumber(rewardRisk, 2)}:1.`,
  };
}
