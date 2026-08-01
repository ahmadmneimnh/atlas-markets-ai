'use client';

import type { QuoteDTO, UnavailableDTO } from '@/lib/dto';
import type { AssetKind } from '@/lib/providers/types';
import { formatCompact, formatCurrency } from '@/lib/format';
import { DeltaPill, InsufficientData, Provenance, Stat } from './ui';
import { LiveIndicator } from './live-indicator';
import { useLive } from './use-live';

interface QuotePayload {
  quote: QuoteDTO | null;
  unavailable: UnavailableDTO | null;
}

/** The live price header on an asset page. */
export function LiveQuote({
  symbol,
  kind,
  initial,
  refreshMs,
}: {
  symbol: string;
  kind: AssetKind;
  initial: QuotePayload;
  refreshMs: number;
}) {
  const { data, updatedAt, refreshing, error, refresh } = useLive<QuotePayload>(
    `/api/quote/${kind}/${encodeURIComponent(symbol)}`,
    refreshMs,
    initial,
  );

  const q = data.quote;

  if (!q) {
    return (
      <InsufficientData
        what={`Live price for ${symbol}`}
        unavailable={data.unavailable}
        hint={
          kind === 'equity' ? (
            <>
              Stock quotes come from Finnhub. Check that{' '}
              <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[11px]">FINNHUB_API_KEY</code>{' '}
              is set in <code className="font-mono text-[11px]">.env.local</code>.
            </>
          ) : undefined
        }
      />
    );
  }

  const changeLabel = kind === 'crypto' ? '24h change' : 'Change since previous close';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="tnum text-4xl font-semibold tracking-tight text-ink">
              {formatCurrency(q.price, q.currency)}
            </span>
            <DeltaPill value={q.changePercent} />
            <span className="tnum text-sm text-ink-muted">
              {q.change >= 0 ? '+' : ''}
              {formatCurrency(q.change, q.currency).replace('$', '')} {q.currency ?? ''}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-faint">{changeLabel}</p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <LiveIndicator
            updatedAt={updatedAt}
            refreshing={refreshing}
            error={error}
            onRefresh={refresh}
            intervalMs={refreshMs}
          />
          <Provenance source={q.source} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Open" value={q.open !== undefined ? formatCurrency(q.open, q.currency) : '—'} />
        <Stat label="Day high" value={q.high !== undefined ? formatCurrency(q.high, q.currency) : '—'} />
        <Stat label="Day low" value={q.low !== undefined ? formatCurrency(q.low, q.currency) : '—'} />
        <Stat
          label="Previous close"
          value={q.previousClose !== undefined ? formatCurrency(q.previousClose, q.currency) : '—'}
        />
        <Stat label="Volume" value={formatCompact(q.volume)} />
      </div>
    </div>
  );
}
