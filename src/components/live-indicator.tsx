'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { formatRelative } from '@/lib/format';
import { useTicker } from './use-live';

/**
 * "Live · updated 12s ago", with a manual refresh.
 *
 * The relative label only renders after mount. Server-rendering it would put one
 * value in the HTML and a different one in the first client render — a hydration
 * mismatch, and a misleading timestamp for anyone whose page sat in a CDN cache.
 */
export function LiveIndicator({
  updatedAt,
  refreshing,
  error,
  onRefresh,
  intervalMs,
}: {
  updatedAt: number | null;
  refreshing: boolean;
  error?: string | null;
  onRefresh: () => void;
  intervalMs: number;
}) {
  const [mounted, setMounted] = useState(false);
  const now = useTicker();
  useEffect(() => setMounted(true), []);

  const every = intervalMs >= 60_000 ? `${Math.round(intervalMs / 60_000)}m` : `${Math.round(intervalMs / 1000)}s`;

  return (
    <div className="flex items-center gap-2 text-xs text-ink-faint">
      <span
        className={clsx(
          'inline-block h-1.5 w-1.5 rounded-full',
          error ? 'bg-bear' : 'animate-pulse-dot bg-bull',
        )}
        aria-hidden
      />
      <span>
        {error ? (
          <span className="text-bear">Refresh failed — showing last received data</span>
        ) : !mounted ? (
          `Live · refreshes every ${every}`
        ) : updatedAt === null ? (
          `Live · refreshes every ${every}`
        ) : (
          `Updated ${formatRelative(new Date(updatedAt), now)}`
        )}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
