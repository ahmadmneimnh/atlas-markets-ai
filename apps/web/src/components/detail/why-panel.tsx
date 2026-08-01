import { clsx } from 'clsx';
import type { TradePlan } from '@/lib/analysis/decision';
import type { AssetScore, Factor, Signal } from '@/lib/analysis/types';
import { Card, DirectionDot, Provenance, SectionTitle } from '../primitives';

/**
 * "Why is AI recommending this?" — the evidence, grouped the way a reader asks
 * for it rather than the way the engine happens to store it.
 *
 * The engine's own units are six factors (technical, fundamental, news, social,
 * macro, risk). A reader asks four questions: what do the charts say, what do the
 * financials say, what does the news say, and what is the market doing. Social and
 * macro answer the last one together, so they are presented together — the
 * grouping is a relabelling of existing measurements, and no signal is created,
 * dropped or reworded on the way through.
 *
 * Nothing in here is generated prose. Every line is a `Signal` the scoring engine
 * produced, printed with the value that drove it and the provider it came from.
 */

interface Group {
  title: string;
  hint: string;
  factors: Factor[];
}

const GROUPS: Group[] = [
  {
    title: 'Technical Analysis',
    hint: 'RSI, MACD, moving averages, trend structure',
    factors: ['technical'],
  },
  {
    title: 'Fundamental Analysis',
    hint: 'revenue, earnings, valuation, growth',
    factors: ['fundamental'],
  },
  {
    title: 'News Analysis',
    hint: 'headline classification and sentiment',
    factors: ['news'],
  },
  {
    title: 'Market Conditions',
    hint: 'sector and macro context, market sentiment',
    factors: ['macro', 'social'],
  },
];

export function WhyPanel({ score, plan }: { score: AssetScore; plan?: TradePlan }) {
  return (
    <div className="space-y-8">
      <section>
        <SectionTitle hint="ranked by contribution to the final score">Reasons</SectionTitle>
        <Card className="divide-y divide-glass-border/50">
          {score.topReasons.length === 0 ? (
            <p className="p-5 text-sm text-ink-faint">
              No directional signals — every available indicator read neutral. That is a finding,
              not an omission.
            </p>
          ) : (
            score.topReasons.map((reason, i) => <ReasonRow key={i} signal={reason} />)
          )}
        </Card>
      </section>

      {GROUPS.map((group) => (
        <FactorGroup key={group.title} group={group} score={score} />
      ))}

      {plan ? <LevelDerivation plan={plan} /> : null}

      {score.omitted.length > 0 ? (
        <section>
          <SectionTitle hint="excluded from the score, not estimated">
            Factors not scored
          </SectionTitle>
          <Card className="divide-y divide-glass-border/50">
            {score.omitted.map((omitted) => (
              <div key={omitted.factor} className="flex items-start gap-3 p-4">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-glass-border text-[10px] text-ink-faint">
                  –
                </span>
                <div>
                  <p className="text-sm font-medium capitalize text-ink-muted">{omitted.factor}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{omitted.reason}</p>
                </div>
              </div>
            ))}
          </Card>
          <p className="mt-3 px-1 text-xs leading-relaxed text-ink-faint">
            These contributed nothing to the score. Their weight was redistributed across the
            factors that had data — they were not assigned a neutral value, because a neutral value
            is a number no evidence supports.
          </p>
        </section>
      ) : null}

      <p className="px-1 text-xs leading-relaxed text-ink-faint">
        Computed {score.computedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC from{' '}
        {score.sources.length} data {score.sources.length === 1 ? 'source' : 'sources'}:{' '}
        <span className="text-ink-muted">{score.sources.join(', ')}</span>.
      </p>
    </div>
  );
}

function ReasonRow({ signal }: { signal: Signal }) {
  // A tick for supporting evidence, a cross for contradicting evidence. The glyph
  // restates the measured direction — it is not a second opinion about it.
  const bullish = signal.direction === 'bullish';
  return (
    <div className="flex items-start gap-3 p-4">
      <span
        aria-hidden
        className={clsx(
          'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
          bullish ? 'bg-bull/12 text-bull' : 'bg-bear/12 text-bear',
        )}
      >
        {bullish ? '✓' : '✗'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {signal.label}: <span className="tnum text-ink-muted">{signal.value}</span>
        </p>
        <p className="mt-0.5 text-xs capitalize text-ink-faint">{signal.direction}</p>
      </div>
      <Provenance source={signal.source} />
    </div>
  );
}

function FactorGroup({ group, score }: { group: Group; score: AssetScore }) {
  const present = score.breakdown.filter((b) => group.factors.includes(b.factor));
  const absent = score.omitted.filter((o) => group.factors.includes(o.factor as Factor));

  return (
    <section>
      <SectionTitle hint={group.hint}>{group.title}</SectionTitle>
      <Card className="divide-y divide-glass-border/50">
        {present.map((breakdown) => (
          <div key={breakdown.factor} className="p-4">
            <div className="flex items-center gap-4">
              <span className="w-24 shrink-0 text-xs font-medium capitalize text-ink-muted">
                {breakdown.factor}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-glass-strong">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold"
                  style={{ width: `${Math.max(0, Math.min(100, breakdown.score))}%` }}
                />
              </div>
              <span className="tnum w-10 shrink-0 text-right text-sm font-semibold">
                {breakdown.score.toFixed(0)}
              </span>
              <span className="tnum w-20 shrink-0 text-right text-[11px] text-ink-faint">
                {breakdown.effectiveWeight.toFixed(0)}% weight
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {breakdown.signals.map((signal, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border border-glass-border/40 p-2.5"
                >
                  <DirectionDot direction={signal.direction} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-ink-muted">{signal.label}</p>
                    <p className="tnum mt-0.5 text-[11px] text-ink-faint">{signal.value}</p>
                  </div>
                  <Provenance source={signal.source} />
                </div>
              ))}
            </div>
          </div>
        ))}

        {absent.map((omitted) => (
          <div key={omitted.factor} className="p-4">
            <p className="text-xs font-medium capitalize text-ink-muted">{omitted.factor}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{omitted.reason}</p>
          </div>
        ))}

        {present.length === 0 && absent.length === 0 ? (
          <p className="p-4 text-xs text-ink-faint">
            This factor did not run and reported no reason — treat its absence as unknown, not as
            neutral.
          </p>
        ) : null}
      </Card>
    </section>
  );
}

/**
 * How entry, target and stop were arrived at.
 *
 * The panel above the fold shows each level with the rule that produced it; this
 * shows the rule's operands. Together they make every price on the page
 * reproducible by hand, which is the only version of "explainable" that survives
 * contact with a reader who disagrees with the answer.
 */
function LevelDerivation({ plan }: { plan: TradePlan }) {
  const sections = [
    { title: 'Entry', method: plan.entry.method, inputs: plan.entry.inputs },
    { title: 'Target', method: plan.target.method, inputs: plan.target.inputs },
    { title: 'Stop', method: plan.stop.method, inputs: plan.stop.inputs },
  ];

  return (
    <section>
      <SectionTitle hint="every operand behind the price levels above">
        How these levels were calculated
      </SectionTitle>
      <Card className="divide-y divide-glass-border/50">
        {sections.map((section) => (
          <div key={section.title} className="p-4">
            <p className="text-sm font-semibold text-ink">{section.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{section.method}</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {section.inputs.map((input, i) => (
                <li
                  key={`${input.label}-${i}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-glass-border/40 px-2.5 py-2"
                >
                  <span className="text-[11px] text-ink-muted">{input.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="tnum text-[11px] text-ink">{input.value}</span>
                    <Provenance source={input.source} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
      <p className="mt-3 px-1 text-xs leading-relaxed text-ink-faint">
        These are rules applied to measured data, not predictions. ATR and pivot levels describe how
        this asset has moved; they do not know what it will do next.
      </p>
    </section>
  );
}
