'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import type { AssetRowDTO } from '@/lib/dto';
import { formatCompact, formatCurrency } from '@/lib/format';
import { Card, Delta, InsufficientData, Provenance, SectionTitle, Stat } from './ui';
import { LiveIndicator } from './live-indicator';
import { useLive } from './use-live';

interface QuotesPayload {
  rows: AssetRowDTO[];
}

/**
 * The dashboard's live surface.
 *
 * One polling loop feeds every panel below. Giving each table its own interval
 * would multiply the request count against a free-tier quota and let two panels
 * disagree about the same asset's price.
 */
export function MarketDashboard({
  initial,
  refreshMs,
  stocksConfigured,
}: {
  initial: QuotesPayload;
  refreshMs: number;
  stocksConfigured: boolean;
}) {
  const { data, updatedAt, refreshing, error, refresh } = useLive<QuotesPayload>(
    '/api/quotes',
    refreshMs,
    initial,
  );

  const rows = data.rows;
  const crypto = rows.filter((r) => r.kind === 'crypto');
  const stocks = rows.filter((r) => r.kind === 'equity');

  const priced = rows.filter((r) => r.quote !== null);
  const advancing = priced.filter((r) => (r.quote?.changePercent ?? 0) > 0).length;
  const declining = priced.filter((r) => (r.quote?.changePercent ?? 0) < 0).length;
  const missing = rows.length - priced.length;

  const byMove = [...priced].sort(
    (a, b) => (b.quote?.changePercent ?? 0) - (a.quote?.changePercent ?? 0),
  );
  const gainers = byMove.filter((r) => (r.quote?.changePercent ?? 0) > 0).slice(0, 5);
  const losers = [...byMove].reverse().filter((r) => (r.quote?.changePercent ?? 0) < 0).slice(0, 5);

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle
          action={
            <LiveIndicator
              updatedAt={updatedAt}
              refreshing={refreshing}
              error={error}
              onRefresh={refresh}
              intervalMs={refreshMs}
            />
          }
        >
          Market overview
        </SectionTitle>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Assets tracked" value={rows.length} sub={`${crypto.length} crypto · ${stocks.length} stocks`} />
          <Stat label="Advancing" value={<span className="text-bull">{advancing}</span>} sub="price up on the period" />
          <Stat label="Declining" value={<span className="text-bear">{declining}</span>} sub="price down on the period" />
          <Stat
            label="Unpriced"
            value={missing > 0 ? <span className="text-ink-muted">{missing}</span> : '0'}
            sub={missing > 0 ? 'shown as Insufficient Data' : 'all sources responded'}
          />
        </div>
      </section>

      {priced.length > 0 ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <MoverPanel title="Top gainers" rows={gainers} empty="Nothing is up across the tracked list right now." />
          <MoverPanel title="Top decliners" rows={losers} empty="Nothing is down across the tracked list right now." />
        </section>
      ) : null}

      <section>
        <SectionTitle hint="24-hour change">Cryptocurrency</SectionTitle>
        <MarketTable rows={crypto} kindLabel="crypto" />
      </section>

      <section>
        <SectionTitle hint={stocksConfigured ? 'change since previous close' : undefined}>
          Stocks
        </SectionTitle>
        {!stocksConfigured ? (
          <Card className="p-0">
            <InsufficientData
              what="Stock prices"
              unavailable={{ reason: 'no_provider_configured' }}
              hint={
                <>
                  Add a free Finnhub key as{' '}
                  <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                    FINNHUB_API_KEY
                  </code>{' '}
                  in <code className="font-mono text-[11px]">.env.local</code>, then restart the app.
                  Step 5 of the README explains how.
                </>
              }
            />
          </Card>
        ) : (
          <MarketTable rows={stocks} kindLabel="stock" />
        )}
      </section>
    </div>
  );
}

function MoverPanel({ title, rows, empty }: { title: string; rows: AssetRowDTO[]; empty: string }) {
  return (
    <Card>
      <h3 className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-xs text-ink-faint">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={`${row.kind}-${row.symbol}`}>
              <Link
                href={`/asset/${row.kind}/${encodeURIComponent(row.symbol)}`}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-canvas"
              >
                <span className="w-14 shrink-0 text-sm font-semibold text-ink">{row.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{row.name}</span>
                <span className="tnum shrink-0 text-sm text-ink">
                  {row.quote ? formatCurrency(row.quote.price, row.quote.currency) : '—'}
                </span>
                <Delta value={row.quote?.changePercent} className="w-20 shrink-0 text-right text-sm" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function MarketTable({ rows, kindLabel }: { rows: AssetRowDTO[]; kindLabel: string }) {
  if (rows.length === 0) {
    return (
      <Card className="p-0">
        <InsufficientData what={`No ${kindLabel} assets are being tracked`} />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        {/* Columns drop out below sm/md/lg, so the minimum only has to fit the
            three that survive on a phone: asset, price, change. */}
        <table className="w-full min-w-[300px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
              <th scope="col" className="px-4 py-2.5 font-medium">Asset</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Price</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Change</th>
              <th scope="col" className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Day range</th>
              <th scope="col" className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Volume</th>
              <th scope="col" className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <MarketRow key={`${row.kind}-${row.symbol}`} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MarketRow({ row }: { row: AssetRowDTO }) {
  const q = row.quote;
  const href = `/asset/${row.kind}/${encodeURIComponent(row.symbol)}`;

  return (
    <tr className="group transition-colors hover:bg-canvas">
      <td className="px-4 py-3">
        <Link href={href} className="block">
          <span className="font-semibold text-ink">{row.symbol}</span>
          <span className="ml-2 text-xs text-ink-muted">{row.name}</span>
        </Link>
      </td>

      {q === null ? (
        <td className="px-4 py-3 text-right" colSpan={5}>
          <InsufficientData compact unavailable={row.unavailable} />
        </td>
      ) : (
        <>
          <td className="px-4 py-3 text-right">
            <PriceCell value={q.price} currency={q.currency} />
          </td>
          <td className="px-4 py-3 text-right">
            <Delta value={q.changePercent} />
          </td>
          <td className="tnum hidden px-4 py-3 text-right text-xs text-ink-muted sm:table-cell">
            {q.low !== undefined && q.high !== undefined
              ? `${formatCurrency(q.low, q.currency)} – ${formatCurrency(q.high, q.currency)}`
              : '—'}
          </td>
          <td className="tnum hidden px-4 py-3 text-right text-xs text-ink-muted md:table-cell">
            {formatCompact(q.volume)}
          </td>
          <td className="hidden px-4 py-3 text-right lg:table-cell">
            <Provenance source={q.source} />
          </td>
        </>
      )}
    </tr>
  );
}

/**
 * A price that flashes when it moves.
 *
 * On a table refreshed every few seconds, a changed number is easy to miss; the
 * flash is the only cue that the figure just updated rather than sat still.
 */
function PriceCell({ value, currency }: { value: number; currency?: string }) {
  const previous = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (value === previous.current) return;
    setFlash(value > previous.current ? 'up' : 'down');
    previous.current = value;
    const timer = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <span
      className={clsx(
        'tnum rounded px-1.5 py-0.5 font-medium text-ink transition-colors duration-300',
        flash === 'up' && 'bg-bull/15',
        flash === 'down' && 'bg-bear/15',
      )}
    >
      {formatCurrency(value, currency)}
    </span>
  );
}
