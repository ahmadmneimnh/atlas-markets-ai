import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { Recommendation, Direction } from '@/lib/analysis/types';

/**
 * Presentational primitives. These components never fetch data and never import
 * from lib/providers — a component that can reach a provider is a component that
 * will eventually fetch during render.
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
  return (
    <div className={clsx('glass rounded-2xl', hover && 'glass-hover', className)}>{children}</div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-muted">{children}</h2>
      {hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
    </div>
  );
}

// ── Provenance ──────────────────────────────────────────────────────────────────

/**
 * Every displayed number carries its origin. This is rendered as a required
 * companion to values rather than an optional tooltip: the product's core promise
 * is that a user can always see where a figure came from.
 */
export function Provenance({ source, asOf }: { source: string; asOf?: Date }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-faint">
      <span className="inline-block h-1 w-1 rounded-full bg-gold/60" />
      {source}
      {asOf ? <span className="normal-case tracking-normal">· {formatRelative(asOf)}</span> : null}
    </span>
  );
}

export function formatRelative(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Empty / unavailable states ──────────────────────────────────────────────────

/**
 * The "no data" state. This is a first-class component because the alternative —
 * rendering a zero, a dash, or a plausible placeholder — is precisely the failure
 * this product must not have.
 */
export function Unavailable({
  title,
  reason,
  hint,
}: {
  title: string;
  reason?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-glass-border/70 px-6 py-10 text-center">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-glass-border text-ink-faint">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {reason ? <p className="mt-1.5 max-w-md text-xs leading-relaxed text-ink-faint">{reason}</p> : null}
      {hint ? (
        <p className="mt-3 rounded-md border border-glass-border bg-canvas-sunken px-3 py-1.5 font-mono text-[11px] text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ── Recommendation ──────────────────────────────────────────────────────────────

const REC_STYLE: Record<Recommendation, { label: string; className: string }> = {
  STRONG_BUY: { label: 'Strong Buy', className: 'border-bull/40 bg-bull/12 text-bull' },
  BUY: { label: 'Buy', className: 'border-bull/30 bg-bull/8 text-bull/90' },
  HOLD: { label: 'Hold', className: 'border-glass-border bg-glass text-ink-muted' },
  SELL: { label: 'Sell', className: 'border-bear/30 bg-bear/8 text-bear/90' },
  STRONG_SELL: { label: 'Strong Sell', className: 'border-bear/40 bg-bear/12 text-bear' },
};

export function RecommendationBadge({
  recommendation,
  size = 'md',
}: {
  recommendation: Recommendation;
  size?: 'sm' | 'md' | 'lg';
}) {
  const style = REC_STYLE[recommendation];
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border font-semibold uppercase tracking-wider',
        style.className,
        size === 'sm' && 'px-2 py-0.5 text-[10px]',
        size === 'md' && 'px-3 py-1 text-xs',
        size === 'lg' && 'px-4 py-1.5 text-sm',
      )}
    >
      {style.label}
    </span>
  );
}

/** Radial score dial, 0–100. */
export function ScoreDial({ score, size = 120 }: { score: number; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const dash = (clamped / 100) * circumference;

  const color = clamped >= 71 ? '#2ecc8f' : clamped >= 56 ? '#7bd6a8' : clamped >= 46 ? '#d4af37' : clamped >= 31 ? '#f0a95c' : '#ff5d6c';

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum text-2xl font-semibold" style={{ color }}>
          {clamped.toFixed(0)}
        </span>
        <span className="text-[9px] uppercase tracking-[0.15em] text-ink-faint">AI Score</span>
      </div>
    </div>
  );
}

// ── Values ──────────────────────────────────────────────────────────────────────

export function Delta({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const positive = value > 0;
  const flat = value === 0;
  return (
    <span
      className={clsx(
        'tnum text-sm font-medium',
        flat ? 'text-ink-muted' : positive ? 'text-bull' : 'text-bear',
      )}
    >
      {positive ? '+' : ''}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}

const DIRECTION_STYLE: Record<Direction, string> = {
  bullish: 'text-bull border-bull/30 bg-bull/8',
  bearish: 'text-bear border-bear/30 bg-bear/8',
  neutral: 'text-ink-faint border-glass-border bg-glass',
};

export function DirectionDot({ direction }: { direction: Direction }) {
  return (
    <span
      className={clsx(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
        DIRECTION_STYLE[direction],
      )}
      aria-label={direction}
    >
      {direction === 'bullish' ? '▲' : direction === 'bearish' ? '▼' : '–'}
    </span>
  );
}

/** Formats large currency values compactly without losing meaningful precision. */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

/**
 * Prices need different precision at different magnitudes: $0.00001234 for a
 * micro-cap token and $185.42 for a large-cap equity. A fixed 2 decimals would
 * render the former as $0.00.
 */
export function formatPrice(n: number): string {
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(4);
  return n.toPrecision(4);
}
