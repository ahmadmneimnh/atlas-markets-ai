import { clsx } from 'clsx';
import type { Action, Confidence, Probabilities, RiskLevel, Verdict } from '@/lib/analysis/types';
import { VERDICT_LABELS } from '@/lib/analysis/scoring';
import { formatNumber } from '@/lib/format';

/**
 * Shared presentation for verdicts, probabilities and conviction.
 *
 * Colour follows the action, never the number alone: a 71 that lands on Hold is
 * rendered as a Hold, so the badge and the bar can never tell different stories.
 */

const VERDICT_STYLE: Record<Verdict, string> = {
  STRONG_BUY: 'border-bull/40 bg-bull/12 text-bull',
  BUY: 'border-bull/30 bg-bull/10 text-bull',
  HOLD: 'border-line bg-ink-faint/10 text-ink-muted',
  SELL: 'border-bear/30 bg-bear/10 text-bear',
  STRONG_SELL: 'border-bear/40 bg-bear/12 text-bear',
};

export function VerdictBadge({ verdict, size = 'md' }: { verdict: Verdict; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border font-semibold uppercase tracking-wider',
        VERDICT_STYLE[verdict],
        size === 'sm' && 'px-2 py-0.5 text-[10px]',
        size === 'md' && 'px-3 py-1 text-xs',
        size === 'lg' && 'px-4 py-1.5 text-sm',
      )}
    >
      {VERDICT_LABELS[verdict]}
    </span>
  );
}

const ACTION_COLOR: Record<Action, string> = {
  BUY: 'rgb(var(--c-bull))',
  HOLD: 'rgb(var(--c-ink-faint))',
  SELL: 'rgb(var(--c-bear))',
};

/** Radial conviction dial, 0–100. */
export function ConvictionDial({
  conviction,
  action,
  size = 132,
}: {
  conviction: number;
  action: Action;
  size?: number;
}) {
  const radius = (size - 14) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, conviction));
  const dash = (clamped / 100) * circumference;
  const color = ACTION_COLOR[action];

  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-line" strokeWidth="7" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum text-2xl font-semibold" style={{ color }}>
          {formatNumber(clamped, 0)}
        </span>
        <span className="text-[9px] uppercase tracking-[0.15em] text-ink-faint">Conviction</span>
      </div>
    </div>
  );
}

/** Stacked Buy / Hold / Sell bar. The three always total 100 by construction. */
export function ProbabilityBar({ probabilities }: { probabilities: Probabilities }) {
  const { buy, hold, sell } = probabilities;

  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ink-faint/10">
        <div className="bg-bull" style={{ width: `${buy}%` }} />
        <div className="bg-ink-faint/40" style={{ width: `${hold}%` }} />
        <div className="bg-bear" style={{ width: `${sell}%` }} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Leg label="Buy" value={buy} className="text-bull" />
        <Leg label="Hold" value={hold} className="text-ink-muted" />
        <Leg label="Sell" value={sell} className="text-bear" />
      </div>
    </div>
  );
}

function Leg({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div>
      <p className={clsx('tnum text-lg font-semibold', className)}>{value}%</p>
      <p className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</p>
    </div>
  );
}

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  'Very High': 'text-bull',
  High: 'text-bull/90',
  Medium: 'text-ink-muted',
  Low: 'text-ink-faint',
};

export function ConfidenceLabel({ confidence }: { confidence: Confidence }) {
  return <span className={clsx('font-semibold', CONFIDENCE_STYLE[confidence])}>{confidence}</span>;
}

const RISK_STYLE: Record<RiskLevel, string> = {
  'Low Risk': 'border-bull/30 bg-bull/10 text-bull',
  'Medium Risk': 'border-line bg-ink-faint/10 text-ink-muted',
  'High Risk': 'border-bear/30 bg-bear/10 text-bear',
  'Very High Risk': 'border-bear/40 bg-bear/15 text-bear',
};

export function RiskBadge({ level, size = 'md' }: { level: RiskLevel; size?: 'sm' | 'md' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border font-semibold uppercase tracking-wider',
        RISK_STYLE[level],
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs',
      )}
    >
      {level}
    </span>
  );
}
