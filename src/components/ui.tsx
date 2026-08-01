import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { formatPercent } from '@/lib/format';
import { explainUnavailable, type UnavailableDTO } from '@/lib/dto';

/**
 * Presentational primitives. Nothing here fetches data or imports from
 * `lib/providers` — a component that can reach a provider is a component that will
 * eventually fetch during render.
 */

export function Card({
  children,
  className,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return <div className={clsx('card', hover && 'card-hover', className)}>{children}</div>;
}

export function SectionTitle({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        {children}
      </h2>
      {action ?? (hint ? <span className="text-xs text-ink-faint">{hint}</span> : null)}
    </div>
  );
}

/**
 * The "we do not have this" state.
 *
 * This is a first-class component because the alternative — rendering a zero, a
 * placeholder price, or a flat line — is exactly the failure this product must not
 * have. The headline wording is fixed at "Insufficient Data" so it reads the same
 * everywhere, with the specific cause underneath.
 */
export function InsufficientData({
  unavailable,
  what,
  hint,
  compact = false,
}: {
  unavailable?: UnavailableDTO | null;
  /** What was being looked up, e.g. "stock prices". */
  what?: string;
  /** Concrete next step, e.g. an env var to set. */
  hint?: ReactNode;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-faint" title={explainUnavailable(unavailable)}>
        <WarnIcon className="h-3.5 w-3.5" />
        Insufficient Data
      </span>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-faint">
        <WarnIcon className="h-4 w-4" />
      </span>
      <p className="text-sm font-semibold text-ink">Insufficient Data</p>
      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-ink-muted">
        {what ? <span className="text-ink-muted">{what}: </span> : null}
        {explainUnavailable(unavailable)}
      </p>
      {hint ? <div className="mt-3 text-xs text-ink-faint">{hint}</div> : null}
    </div>
  );
}

export function WarnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
    </svg>
  );
}

/** A signed percentage, coloured by direction. */
export function Delta({
  value,
  className,
  showArrow = false,
}: {
  value: number | undefined;
  className?: string;
  showArrow?: boolean;
}) {
  if (value === undefined || !Number.isFinite(value)) {
    return <span className={clsx('tnum text-ink-faint', className)}>—</span>;
  }
  const flat = value === 0;
  return (
    <span
      className={clsx(
        'tnum font-medium',
        flat ? 'text-ink-muted' : value > 0 ? 'text-bull' : 'text-bear',
        className,
      )}
    >
      {showArrow && !flat ? (value > 0 ? '▲ ' : '▼ ') : null}
      {formatPercent(value)}
    </span>
  );
}

/** Coloured pill version of Delta, for headline figures. */
export function DeltaPill({ value }: { value: number | undefined }) {
  if (value === undefined || !Number.isFinite(value)) {
    return (
      <span className="inline-flex items-center rounded-md border border-line px-2 py-0.5 text-xs text-ink-faint">
        —
      </span>
    );
  }
  const flat = value === 0;
  return (
    <span
      className={clsx(
        'tnum inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold',
        flat
          ? 'bg-ink-faint/10 text-ink-muted'
          : value > 0
            ? 'bg-bull/10 text-bull'
            : 'bg-bear/10 text-bear',
      )}
    >
      {formatPercent(value)}
    </span>
  );
}

/**
 * Where a number came from. Rendered as a companion to values rather than an
 * optional tooltip: if a figure is on screen, its source is too.
 */
export function Provenance({ source, className }: { source: string; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-faint',
        className,
      )}
    >
      <span className="inline-block h-1 w-1 rounded-full bg-accent/70" />
      {source}
    </span>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-md border border-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Label/value pair used in the statistics grids. */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3.5 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="tnum mt-1 text-sm font-semibold text-ink">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-ink-faint">{sub}</p> : null}
    </div>
  );
}
