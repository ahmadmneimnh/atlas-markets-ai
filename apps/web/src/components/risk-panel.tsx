import { clsx } from 'clsx';

import type { RiskAssessment, RiskNote } from '@/lib/analysis/types';

/**
 * Risk explanation, rendered as two visually distinct groups.
 *
 * Measured risk and analysis caveats are never merged into one list. "This asset
 * fell 60% last year" and "we could not score three of six factors" are different
 * kinds of claim, and blending them lets a reader mistake our ignorance for the
 * asset's stability, or the reverse. Each measured statement shows the value it
 * came from so it can be checked rather than trusted.
 */

const SEVERITY_STYLE: Record<RiskNote['severity'], string> = {
  high: 'border-bear/35 bg-bear/[0.07] text-bear',
  medium: 'border-warn/35 bg-warn/[0.07] text-warn',
  low: 'border-glass-border bg-glass text-ink-muted',
};

const SEVERITY_LABEL: Record<RiskAssessment['severity'], string> = {
  high: 'Elevated risk',
  medium: 'Moderate risk',
  low: 'Contained risk',
};

function Note({ note }: { note: RiskNote }) {
  return (
    <li className={clsx('rounded-xl border px-4 py-3', SEVERITY_STYLE[note.severity])}>
      <p className="text-sm leading-relaxed text-ink">{note.text}</p>
      {note.signal ? (
        <p className="mt-2 text-xs text-ink-faint">
          <span className="tnum">{note.signal.value}</span>
          {' · '}
          {note.signal.label}
          {' · '}
          source: {note.signal.source}
        </p>
      ) : null}
    </li>
  );
}

export function RiskPanel({ risk }: { risk: RiskAssessment }) {
  return (
    <section aria-labelledby="risk-heading" className="space-y-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="risk-heading"
          className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-muted"
        >
          Risk analysis
        </h2>
        <span
          className={clsx(
            'rounded-full border px-3 py-1 text-xs font-medium',
            SEVERITY_STYLE[risk.severity],
          )}
        >
          {SEVERITY_LABEL[risk.severity]}
        </span>
      </div>

      {risk.drivers.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs uppercase tracking-widest text-ink-faint">
            Measured — properties of this asset
          </h3>
          <ul className="space-y-2">
            {risk.drivers.map((note, i) => (
              <Note key={`driver-${i}`} note={note} />
            ))}
          </ul>
        </div>
      ) : null}

      {risk.caveats.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs uppercase tracking-widest text-ink-faint">
            Limits of this analysis
          </h3>
          <ul className="space-y-2">
            {risk.caveats.map((note, i) => (
              <Note key={`caveat-${i}`} note={note} />
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-ink-faint">
        Algorithmic analysis of public data. Not investment advice.
      </p>
    </section>
  );
}
