import { clsx } from 'clsx';

import type { FearGreed } from '@/lib/providers/types';

/**
 * Fear & Greed gauge.
 *
 * The label under the number is the **vendor's** classification, not one derived
 * here. Re-deriving it would silently disagree with the published bands the first
 * time the vendor moves one, and users compare this against the source.
 *
 * The market it covers is stated on the face of the component. Alternative.me's
 * index is crypto-only; CNN's equity index is built differently and disagrees
 * routinely. A gauge labelled just "Fear & Greed" next to a stock list implies a
 * scope the number does not have.
 */

function tone(value: number): string {
  if (value <= 24) return 'text-bear';
  if (value <= 44) return 'text-warn';
  if (value <= 55) return 'text-ink-muted';
  if (value <= 75) return 'text-bull';
  return 'text-bull';
}

function Delta({ label, from, to }: { label: string; from: number; to: number }) {
  const delta = to - from;
  const sign = delta > 0 ? '+' : '';
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-ink-faint">{label}</span>
      <span
        className={clsx(
          'tnum',
          delta > 0 ? 'text-bull' : delta < 0 ? 'text-bear' : 'text-ink-muted',
        )}
      >
        {from} ({sign}
        {delta})
      </span>
    </div>
  );
}

export function FearGreedGauge({ reading }: { reading: FearGreed }) {
  const percent = Math.max(0, Math.min(100, reading.value));

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <span className={clsx('tnum text-4xl font-semibold', tone(reading.value))}>
          {reading.value}
        </span>
        <span className="text-sm text-ink-muted">{reading.classification}</span>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-glass-strong"
        role="meter"
        aria-valuenow={reading.value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Crypto Fear and Greed index: ${reading.value}, ${reading.classification}`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-bear via-warn to-bull"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="space-y-1">
        {reading.previousClose !== undefined ? (
          <Delta label="Yesterday" from={reading.previousClose} to={reading.value} />
        ) : null}
        {reading.weekAgo !== undefined ? (
          <Delta label="A week ago" from={reading.weekAgo} to={reading.value} />
        ) : null}
      </div>

      <p className="text-xs text-ink-faint">
        Crypto market only · {reading.source} · {reading.asOf.toISOString().slice(0, 10)}
      </p>
    </div>
  );
}
