'use client';

import { useId, useState } from 'react';
import { clsx } from 'clsx';

import type { Signal } from '@/lib/analysis/types';

/**
 * The per-card "Show Analysis" disclosure.
 *
 * A sibling of the card's link, never a child of it. A `<button>` nested inside
 * an `<a>` is invalid HTML, and browsers resolve it by making one of the two
 * unreachable — usually the button, so the analysis would silently never open
 * for keyboard users while looking fine to a mouse.
 *
 * Content is server-rendered and passed in, then hidden with CSS rather than
 * unmounted: expanding is instant and find-in-page still reaches it, matching
 * the disclosure on the detail page.
 */

const GROUPS: { factor: Signal['factor']; title: string }[] = [
  { factor: 'technical', title: 'Technical' },
  { factor: 'fundamental', title: 'Fundamental' },
  { factor: 'news', title: 'News' },
  { factor: 'social', title: 'Social' },
  { factor: 'macro', title: 'Macro' },
  { factor: 'risk', title: 'Risk' },
];

export function CardAnalysis({ citations }: { citations: Signal[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (citations.length === 0) return null;

  // Only groups with evidence are rendered. An empty "Fundamental" heading on a
  // crypto card implies a gap in the data rather than a factor that does not
  // apply to the asset class.
  const groups = GROUPS.map((group) => ({
    ...group,
    signals: citations.filter((signal) => signal.factor === group.factor),
  })).filter((group) => group.signals.length > 0);

  // Signals that reached the card without a factor stamp still have to appear —
  // dropping evidence because its label is missing would be the worst possible
  // way to handle a metadata gap.
  const unattributed = citations.filter(
    (signal) => !GROUPS.some((group) => group.factor === signal.factor),
  );

  return (
    <div className="mt-3 border-t border-glass-border/60 pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 rounded-md text-left text-[11px] font-medium text-ink-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        <span>{open ? 'Hide Analysis' : 'Show Analysis'}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
          className={clsx('shrink-0 text-gold transition-transform', open && 'rotate-180')}
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div id={panelId} hidden={!open} className={open ? 'mt-3 space-y-3' : ''}>
        {groups.map((group) => (
          <div key={group.title}>
            <p className="text-[9px] uppercase tracking-widest text-ink-faint">{group.title}</p>
            <ul className="mt-1 space-y-1">
              {group.signals.map((signal, i) => (
                <SignalRow key={`${group.title}-${i}`} signal={signal} />
              ))}
            </ul>
          </div>
        ))}

        {unattributed.length > 0 ? (
          <div>
            <p className="text-[9px] uppercase tracking-widest text-ink-faint">Other signals</p>
            <ul className="mt-1 space-y-1">
              {unattributed.map((signal, i) => (
                <SignalRow key={`other-${i}`} signal={signal} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  const bullish = signal.direction === 'bullish';
  const bearish = signal.direction === 'bearish';

  return (
    <li className="flex items-baseline gap-2 text-[11px]">
      <span
        aria-hidden
        className={clsx(
          'shrink-0 font-bold',
          bullish ? 'text-bull' : bearish ? 'text-bear' : 'text-ink-faint',
        )}
      >
        {bullish ? '✓' : bearish ? '✗' : '·'}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink-muted">{signal.label}</span>
      <span className="tnum shrink-0 text-ink">{signal.value}</span>
      {/* The provider stays on every row. A signal without its source is the one
          thing a card must not show — it is indistinguishable from an assertion. */}
      <span className="shrink-0 text-[9px] uppercase tracking-wider text-ink-faint">
        {signal.source}
      </span>
    </li>
  );
}
