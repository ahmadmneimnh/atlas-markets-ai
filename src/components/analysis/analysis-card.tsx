import { clsx } from 'clsx';
import type { ModuleResult, Recommendation, WeightBreakdown } from '@/lib/analysis/types';
import { formatNumber } from '@/lib/format';
import { explainUnavailable } from '@/lib/dto';
import { Card, InsufficientData, Provenance, SectionTitle } from '@/components/ui';

/**
 * The evidence layer: what each module measured, what it scored, and how much of the
 * verdict it was allowed to carry.
 *
 * Unavailable modules keep their place in the list rather than disappearing. A reader
 * needs to see that fundamentals were missing — that is the difference between a
 * verdict built on three inputs and one built on four.
 */
export function AnalysisCard({ rec }: { rec: Recommendation }) {
  const weightOf = (id: string): WeightBreakdown | undefined => rec.weights.find((w) => w.id === id);

  return (
    <section>
      <SectionTitle hint="Technical 40% · Fundamentals 30% · Market 20% · Sentiment 10%">
        Analysis
      </SectionTitle>

      <div className="grid gap-4 lg:grid-cols-2">
        {rec.modules.map((module) => (
          <ModulePanel key={module.id} module={module} weight={weightOf(module.id)} />
        ))}
      </div>
    </section>
  );
}

function ModulePanel({ module, weight }: { module: ModuleResult; weight?: WeightBreakdown }) {
  return (
    <Card className="flex flex-col p-0">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{module.label}</h3>
          <p className="text-[11px] text-ink-faint">
            {weight ? `${formatNumber(weight.nominal * 100, 0)}% nominal weight` : null}
            {weight && module.available
              ? ` · ${formatNumber(weight.applied * 100, 0)}% applied`
              : weight
                ? ' · redistributed to the modules that reported'
                : null}
          </p>
        </div>

        {module.available ? (
          <ScorePill score={module.score} completeness={module.completeness} />
        ) : (
          <span className="shrink-0 rounded-md border border-dashed border-line px-2 py-1 text-[10px] uppercase tracking-wider text-ink-faint">
            Insufficient Data
          </span>
        )}
      </header>

      {module.available ? (
        <div className="flex flex-1 flex-col justify-between">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 py-4 sm:grid-cols-3">
            {module.metrics.map((metric) => (
              <div key={metric.label} className="min-w-0">
                <dt className="truncate text-[11px] uppercase tracking-wider text-ink-faint" title={metric.hint}>
                  {metric.label}
                </dt>
                <dd
                  className={clsx(
                    'tnum truncate text-sm font-medium',
                    metric.value === null ? 'text-ink-faint'
                    : metric.direction === 'bullish' ? 'text-bull'
                    : metric.direction === 'bearish' ? 'text-bear'
                    : 'text-ink',
                  )}
                  title={metric.value ?? 'Not supplied by the data source'}
                >
                  {metric.value ?? '—'}
                </dd>
              </div>
            ))}
          </dl>

          <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <span className="text-[11px] text-ink-faint">
              {formatNumber(module.completeness * 100, 0)}% of this module&apos;s inputs were available
            </span>
            <span className="flex gap-2">
              {module.sources.map((s) => (
                <Provenance key={s} source={s} />
              ))}
            </span>
          </footer>
        </div>
      ) : (
        <div className="px-4 py-5">
          <p className="text-xs leading-relaxed text-ink-muted">
            {explainUnavailable(module.unavailable)}
          </p>
          {module.unavailable.detail ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{module.unavailable.detail}</p>
          ) : null}
          <p className="mt-2 text-[11px] text-ink-faint">
            Its weight was redistributed across the modules that did report, and the confidence of
            the recommendation was reduced.
          </p>
        </div>
      )}
    </Card>
  );
}

function ScorePill({ score, completeness }: { score: number; completeness: number }) {
  const tone = score >= 60 ? 'text-bull' : score <= 40 ? 'text-bear' : 'text-ink-muted';
  return (
    <div className="shrink-0 text-right" title={`${formatNumber(completeness * 100, 0)}% of inputs available`}>
      <span className={clsx('tnum text-lg font-semibold', tone)}>{formatNumber(score, 0)}</span>
      <span className="text-[11px] text-ink-faint">/100</span>
    </div>
  );
}

/** Used on the asset page when the engine could not issue a verdict at all. */
export function AnalysisUnavailableCard({ modules, detail }: { modules: ModuleResult[]; detail?: string }) {
  return (
    <section>
      <SectionTitle>Analysis</SectionTitle>
      <Card className="p-0">
        <InsufficientData
          what="Recommendation"
          // The engine's own detail is far more specific than anything the generic
          // reason code can say, so it is shown verbatim when present.
          {...(detail ? { message: detail } : { unavailable: { reason: 'not_found' as const } })}
          hint="At least half of the scoring weight must come from real data before a verdict is issued."
        />
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {modules.map((module) => (
          <ModulePanel key={module.id} module={module} />
        ))}
      </div>
    </section>
  );
}
