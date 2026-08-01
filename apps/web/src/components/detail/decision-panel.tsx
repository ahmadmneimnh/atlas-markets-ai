import { clsx } from 'clsx';
import type { TradePlan } from '@/lib/analysis/decision';
import {
  Card,
  Provenance,
  RecommendationBadge,
  SourceList,
  Unavailable,
  formatPrice,
} from '../primitives';

/**
 * The decision, stated as five answers: what to do, how sure, at what price, where
 * to take profit, where to admit it was wrong.
 *
 * Every figure here is rendered next to the rule that produced it. That is the
 * point of the panel rather than a decoration on it — an entry range with no
 * stated derivation is indistinguishable from a number someone made up, and a
 * reader has no way to audit it. The `method` line under each level is the audit.
 */

const RISK_STYLE = {
  low: 'border-bull/30 bg-bull/8 text-bull/90',
  medium: 'border-warn/30 bg-warn/8 text-warn',
  high: 'border-bear/35 bg-bear/10 text-bear',
} as const;

const STANCE_COPY = {
  long: {
    entry: 'Suggested Entry',
    entryHint: 'range to accumulate in',
    target: 'Target Price',
    targetHint: 'where to take profit',
    stop: 'Stop Loss',
    stopHint: 'where the thesis is wrong',
  },
  exit: {
    entry: 'Suggested Exit',
    entryHint: 'range to reduce into',
    target: 'Downside Objective',
    targetHint: 'where the move is likely done',
    stop: 'Invalidation',
    stopHint: 'above here the sell case fails',
  },
  watch: {
    entry: 'Accumulation Zone',
    entryHint: 'not an action — the level that would make this attractive',
    target: 'Target Price',
    targetHint: 'if the zone is reached',
    stop: 'Stop Loss',
    stopHint: 'if the zone is reached',
  },
} as const;

function money(value: number, currency?: string): string {
  const symbol = currency === 'USD' || currency === 'USDT' ? '$' : '';
  return `${symbol}${formatPrice(value)}`;
}

export function DecisionPanel({ plan }: { plan: TradePlan }) {
  const copy = STANCE_COPY[plan.stance];

  return (
    <section className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-faint">AI Recommendation</p>
            <div className="mt-2 flex items-center gap-3">
              <RecommendationBadge recommendation={plan.action} size="lg" />
              <span
                className={clsx(
                  'tnum text-2xl font-semibold',
                  plan.confidence < 40 ? 'text-warn' : 'text-ink',
                )}
              >
                {plan.confidence}%
              </span>
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">
              Confidence — how much evidence the score rests on, not how large the move is expected
              to be.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={clsx(
                'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider',
                RISK_STYLE[plan.riskLevel],
              )}
            >
              {plan.riskLevel} risk
            </span>
            <span
              className={clsx(
                'tnum rounded-full border px-3 py-1 text-xs',
                plan.riskRewardBelowTarget
                  ? 'border-warn/30 bg-warn/8 text-warn'
                  : 'border-glass-border bg-glass text-ink-muted',
              )}
            >
              {plan.riskReward.toFixed(2)}:1 reward-to-risk
            </span>
          </div>
        </div>

        {plan.stance === 'watch' ? (
          <p className="mt-5 rounded-lg border border-glass-border bg-glass px-3 py-2 text-xs leading-relaxed text-ink-muted">
            This is a <strong className="font-semibold text-ink">Hold</strong>. The levels below are
            not a call to act — they describe where this would become attractive, so the reader has
            something to wait for rather than a blank panel.
          </p>
        ) : null}

        {plan.riskRewardBelowTarget ? (
          <p className="mt-3 rounded-lg border border-warn/25 bg-warn/8 px-3 py-2 text-xs leading-relaxed text-warn">
            No level ahead of the entry offered 1.5:1 or better. The target was not moved out to
            make the ratio look acceptable — the ratio is reported as it is.
          </p>
        ) : null}

        <div className="mt-6 grid gap-px overflow-hidden rounded-xl bg-glass-border/40 sm:grid-cols-2 lg:grid-cols-4">
          <Level
            label="Current Price"
            hint="live, from the provider named below"
            value={money(plan.currentPrice, plan.currency)}
            method={`Observed ${plan.priceAsOf.toISOString().replace('T', ' ').slice(0, 16)} UTC`}
            source={plan.priceSource}
          />
          <Level
            label={copy.entry}
            hint={copy.entryHint}
            value={`${money(plan.entry.low, plan.currency)} – ${money(plan.entry.high, plan.currency)}`}
            method={plan.entry.method}
          />
          <Level
            label={copy.target}
            hint={copy.targetHint}
            value={money(plan.target.price, plan.currency)}
            method={plan.target.method}
            tone="bull"
          />
          <Level
            label={copy.stop}
            hint={copy.stopHint}
            value={money(plan.stop.price, plan.currency)}
            method={plan.stop.method}
            tone="bear"
          />
        </div>

        {/* Sources sit with the recommendation, not behind the explanation
            toggle. Every number above came from one of these, and a reader
            deciding whether to act on them is entitled to see which without
            opening anything. */}
        <div className="mt-5 border-t border-glass-border/60 pt-4">
          <SourceList sources={plan.sources} />
        </div>
      </Card>

      {plan.missing.length > 0 ? (
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-ink-faint">
            Inputs this plan did not have
          </p>
          <ul className="mt-2 space-y-1.5">
            {plan.missing.map((item) => (
              <li key={item} className="flex gap-2 text-xs leading-relaxed text-ink-faint">
                <span aria-hidden className="text-ink-faint">
                  –
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </section>
  );
}

function Level({
  label,
  hint,
  value,
  method,
  source,
  tone,
}: {
  label: string;
  hint: string;
  value: string;
  method: string;
  source?: string;
  tone?: 'bull' | 'bear';
}) {
  return (
    <div className="bg-canvas-raised p-4">
      <p className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p
        className={clsx(
          'tnum mt-1.5 text-lg font-semibold',
          tone === 'bull' && 'text-bull',
          tone === 'bear' && 'text-bear',
          !tone && 'text-ink',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>
      <p className="mt-2 border-t border-glass-border/50 pt-2 text-[11px] leading-relaxed text-ink-muted">
        {method}
      </p>
      {source ? (
        <div className="mt-1.5">
          <Provenance source={source} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shown in place of the panel when a plan could not be derived.
 *
 * The required wording is exact and the reasons are listed underneath, because
 * "Insufficient data for recommendation" on its own invites the reader to assume
 * a bug. Naming the missing input tells them whether configuring a provider would
 * fix it.
 */
export function DecisionUnavailable({ message, missing }: { message: string; missing: string[] }) {
  return (
    <section>
      <Unavailable
        title={message}
        reason={
          missing[0] ?? 'The inputs required to derive entry, target and stop were not available.'
        }
        hint="No entry, target or stop is shown rather than an estimated one. A price level that is not derived from measured data is a guess wearing a decimal point."
      />
      {missing.length > 1 ? (
        <Card className="mt-3 p-4">
          <ul className="space-y-1.5">
            {missing.slice(1).map((item) => (
              <li key={item} className="flex gap-2 text-xs leading-relaxed text-ink-faint">
                <span aria-hidden>–</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </section>
  );
}
