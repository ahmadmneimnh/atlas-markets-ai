'use client';

import { useId, useState } from 'react';

/**
 * The collapsible "Show AI Analysis" section.
 *
 * A real `<button>` driving `aria-expanded` and `aria-controls`, not a styled
 * div — a details disclosure that a keyboard cannot reach is a section that does
 * not exist for a meaningful share of readers.
 *
 * The children are rendered by the server and passed in already-built, then
 * hidden with CSS rather than unmounted. Two reasons: the content is present for
 * find-in-page and for a crawler even while collapsed, and expanding is instant
 * rather than triggering a fetch the reader has to wait through.
 */
export function AiAnalysis({
  children,
  factorCount,
  omittedCount,
}: {
  children: React.ReactNode;
  factorCount: number;
  omittedCount: number;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="glass glass-hover flex w-full items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        <span>
          <span className="block text-sm font-semibold text-ink">
            {open ? 'Hide AI Analysis' : 'Show AI Analysis'}
          </span>
          <span className="mt-0.5 block text-xs text-ink-faint">
            {factorCount} factor{factorCount === 1 ? '' : 's'} scored
            {omittedCount > 0 ? ` · ${omittedCount} could not be scored` : ''} · technical,
            fundamental, news, social, macro, risk
          </span>
        </span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
          className={`shrink-0 text-gold transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div id={panelId} hidden={!open} className={open ? 'mt-6 animate-fade-up space-y-8' : ''}>
        {children}
      </div>
    </section>
  );
}
