import { clsx } from 'clsx';
import type { Evidence, ModuleId, Recommendation } from '@/lib/analysis/types';
import { Card, SectionTitle } from '@/components/ui';

/**
 * Why the verdict exists.
 *
 * Every line here was produced by a module from a measured value, and each one is
 * tagged with the module that said it — so a reader can go to the Analysis card and
 * find the number behind the sentence.
 */

const MODULE_TAG: Record<ModuleId, string> = {
  technical: 'Technical',
  fundamental: 'Fundamentals',
  market: 'Market',
  sentiment: 'News',
};

export function ExplanationCard({ rec }: { rec: Recommendation }) {
  return (
    <section>
      <SectionTitle hint={`${rec.reasons.length} reasons · ${rec.warnings.length} warnings`}>
        Why this recommendation
      </SectionTitle>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <h3 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">Reasons</h3>
          {rec.reasons.length === 0 ? (
            <p className="px-4 py-4 text-xs text-ink-faint">
              No module produced a supporting observation for this asset.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {rec.reasons.map((e, i) => (
                <EvidenceRow key={`${e.module}-${i}`} evidence={e} />
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-0">
          <h3 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">Warnings</h3>
          {rec.warnings.length === 0 ? (
            <p className="px-4 py-4 text-xs text-ink-faint">
              No module raised a warning. That is an absence of measured negatives, not a guarantee.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {rec.warnings.map((e, i) => (
                <EvidenceRow key={`${e.module}-${i}`} evidence={e} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

function EvidenceRow({ evidence }: { evidence: Evidence }) {
  const isWarning = evidence.kind === 'warning';
  const mark = isWarning ? '!' : evidence.direction === 'neutral' ? '·' : '✓';

  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span
        aria-hidden
        className={clsx(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
          isWarning
            ? 'bg-bear/15 text-bear'
            : evidence.direction === 'bullish'
              ? 'bg-bull/15 text-bull'
              : 'bg-ink-faint/15 text-ink-faint',
        )}
      >
        {mark}
      </span>
      <span className="min-w-0 flex-1 text-xs leading-relaxed text-ink-muted">{evidence.text}</span>
      <span
        className={clsx(
          'shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
          evidence.impact === 'high' ? 'text-ink-muted' : 'text-ink-faint',
        )}
        title={`${evidence.impact} impact`}
      >
        {MODULE_TAG[evidence.module]}
      </span>
    </li>
  );
}
