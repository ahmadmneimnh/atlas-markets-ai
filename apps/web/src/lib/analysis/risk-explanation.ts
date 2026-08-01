import type { RiskAssessment, RiskNote, ScoreBreakdown, Signal } from './types';

/**
 * Builds the risk explanation that accompanies every recommendation.
 *
 * The rule this file exists to enforce: **every sentence is derived from a value
 * the system actually holds.** There is no template pool, no "moderate risk"
 * default, and no LLM prose. Each note carries the `Signal` it came from, so the
 * UI can show the number next to the sentence and a reader can check it.
 *
 * The temptation is a paragraph generator that always produces something
 * reassuringly fluent. That would be the most dangerous component in the system:
 * a fluent risk narrative for an asset with 30% factor coverage reads as informed
 * caution, when the honest statement is "we do not know enough to say".
 *
 * Two categories are produced and they are not interchangeable:
 *
 *  - **drivers** — measured risk. Volatility, drawdown, ATR. These describe the
 *    asset.
 *  - **caveats** — limits of the analysis itself. Missing factors, thin coverage,
 *    low-confidence classifiers. These describe *us*, and omitting them is how a
 *    score built on one factor gets read as a considered view.
 */

/** Thresholds are stated once, here, so the prose and the scoring cannot diverge. */
const VOLATILITY_HIGH = 60;
const VOLATILITY_ELEVATED = 35;
const DRAWDOWN_SEVERE = 50;
const DRAWDOWN_NOTABLE = 30;
const ATR_HIGH = 5;
const COVERAGE_THIN = 0.5;
const CONFIDENCE_LOW = 45;

function parseValue(signal: Signal): number | undefined {
  // Signal values are display strings ("62.4%", "1.8×"). The numeric prefix is
  // what the thresholds compare against; anything unparseable is skipped rather
  // than coerced, because a NaN comparison silently reads as "not risky".
  const match = /-?\d+(\.\d+)?/.exec(signal.value);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function find(signals: Signal[], fragment: string): Signal | undefined {
  return signals.find((s) => s.label.toLowerCase().includes(fragment));
}

export function buildRiskExplanation(
  breakdown: ScoreBreakdown[],
  omitted: { factor: string; reason: string }[],
  coverage: number,
  confidence: number,
): RiskAssessment {
  const drivers: RiskNote[] = [];
  const caveats: RiskNote[] = [];

  const riskFactor = breakdown.find((b) => b.factor === 'risk');
  const riskSignals = riskFactor?.signals ?? [];

  const volatility = find(riskSignals, 'volatility');
  const volatilityValue = volatility ? parseValue(volatility) : undefined;
  if (volatility && volatilityValue !== undefined) {
    if (volatilityValue >= VOLATILITY_HIGH) {
      drivers.push({
        severity: 'high',
        text: `Annualised volatility of ${volatility.value} means daily swings of several percent are normal for this asset, not exceptional.`,
        signal: volatility,
      });
    } else if (volatilityValue >= VOLATILITY_ELEVATED) {
      drivers.push({
        severity: 'medium',
        text: `Annualised volatility of ${volatility.value} is elevated; position sizing matters more here than the direction of the score.`,
        signal: volatility,
      });
    } else {
      drivers.push({
        severity: 'low',
        text: `Annualised volatility of ${volatility.value} is moderate by this asset class's standards.`,
        signal: volatility,
      });
    }
  }

  const drawdown = find(riskSignals, 'drawdown');
  const drawdownValue = drawdown ? Math.abs(parseValue(drawdown) ?? 0) : undefined;
  if (drawdown && drawdownValue !== undefined) {
    if (drawdownValue >= DRAWDOWN_SEVERE) {
      drivers.push({
        severity: 'high',
        text: `A ${drawdown.value} peak-to-trough decline occurred within the last year. A drawdown of that size has happened before and can happen again.`,
        signal: drawdown,
      });
    } else if (drawdownValue >= DRAWDOWN_NOTABLE) {
      drivers.push({
        severity: 'medium',
        text: `Maximum drawdown over the last year was ${drawdown.value}.`,
        signal: drawdown,
      });
    }
  }

  const atr = find(riskSignals, 'atr');
  const atrValue = atr ? parseValue(atr) : undefined;
  if (atr && atrValue !== undefined && atrValue >= ATR_HIGH) {
    drivers.push({
      severity: 'medium',
      text: `Average true range is ${atr.value} of price, so a stop placed inside that band will be hit by ordinary noise rather than by a change in trend.`,
      signal: atr,
    });
  }

  // ── Caveats: what the analysis itself could not see ────────────────────────

  if (omitted.length > 0) {
    const names = omitted.map((o) => o.factor).join(', ');
    caveats.push({
      severity: omitted.length >= 3 ? 'high' : 'medium',
      text: `${omitted.length} of 6 factors could not be scored (${names}). Their weight was removed and the rest renormalized — the score reflects only what was measurable.`,
    });
  }

  if (coverage < COVERAGE_THIN) {
    caveats.push({
      severity: 'high',
      text: `Only ${Math.round(coverage * 100)}% of the intended factor weight was available. Treat this score as a partial view, not a considered one.`,
    });
  }

  if (confidence < CONFIDENCE_LOW) {
    caveats.push({
      severity: 'medium',
      text: `Confidence is ${Math.round(confidence)}/100. Score and confidence are independent: this is a thinly-evidenced reading, whichever direction it points.`,
    });
  }

  // A factor scored on capped-confidence evidence — the news lexicon is the
  // current example — should say so rather than be counted at face value.
  for (const factor of breakdown) {
    if (factor.confidence <= 0.6 && factor.effectiveWeight >= 10) {
      caveats.push({
        severity: 'low',
        text: `The ${factor.factor} factor carries ${factor.effectiveWeight.toFixed(0)}% of the weight but only ${Math.round(factor.confidence * 100)}% internal confidence.`,
      });
    }
  }

  // Keyed on `drivers`, not on `riskSignals`. A risk factor that produced signals
  // whose values would not parse is indistinguishable, from the reader's side,
  // from one that produced nothing — and in both cases saying nothing about risk
  // is the worst available output. The condition asks "did we end up with a
  // usable risk statement", which is the question that matters.
  if (drivers.length === 0) {
    caveats.push({
      severity: 'high',
      text: 'No risk metrics could be computed for this asset — volatility, drawdown and ATR all require price history that was unavailable or unreadable.',
    });
  }

  const severity: RiskAssessment['severity'] = [...drivers, ...caveats].some(
    (n) => n.severity === 'high',
  )
    ? 'high'
    : [...drivers, ...caveats].some((n) => n.severity === 'medium')
      ? 'medium'
      : 'low';

  return { severity, drivers, caveats };
}
