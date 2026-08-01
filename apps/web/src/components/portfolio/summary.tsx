import { clsx } from 'clsx';

import type { PortfolioSummary } from '@/lib/portfolio/analytics';
import { Card } from '@/components/primitives';

/**
 * Portfolio valuation panel.
 *
 * Unpriced holdings get their own block rather than being folded into the
 * totals. A portfolio where half the positions could not be priced is a
 * different object from one that is genuinely flat, and the headline return has
 * to say which it is looking at.
 */

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs uppercase tracking-widest text-ink-faint">{label}</p>
      <p
        className={clsx(
          'tnum mt-1 text-xl font-semibold',
          tone === 'up' ? 'text-bull' : tone === 'down' ? 'text-bear' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function PortfolioSummaryPanel({
  summary,
  currency,
}: {
  summary: PortfolioSummary;
  currency: string;
}) {
  const up = summary.totalUnrealizedPnl >= 0;

  return (
    <div className="space-y-5">
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-glass-border/40 sm:grid-cols-4">
        <div className="bg-canvas-raised">
          <Stat label="Market value" value={money(summary.totalMarketValue, currency)} />
        </div>
        <div className="bg-canvas-raised">
          <Stat label="Cost basis" value={money(summary.totalCostBasis, currency)} />
        </div>
        <div className="bg-canvas-raised">
          <Stat
            label="Unrealised P/L"
            value={money(summary.totalUnrealizedPnl, currency)}
            tone={up ? 'up' : 'down'}
          />
        </div>
        <div className="bg-canvas-raised">
          <Stat
            label="Total return"
            value={`${up ? '+' : ''}${summary.totalReturnPercent.toFixed(2)}%`}
            tone={up ? 'up' : 'down'}
          />
        </div>
      </Card>

      {summary.pricedCoverage < 1 ? (
        <p className="rounded-xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-sm text-ink">
          Returns above cover the {(summary.pricedCoverage * 100).toFixed(0)}% of cost basis that
          could be priced. Unpriced positions are listed below and excluded from every figure —
          valuing them at cost would report them as exactly break-even.
        </p>
      ) : null}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-glass-border/60 text-left">
              {['Asset', 'Qty', 'Avg cost', 'Price', 'Value', 'P/L', 'Weight', 'Held'].map((h) => (
                <th key={h} className="px-4 py-3 font-medium text-ink-faint last:text-right">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.holdings.map((h) => (
              <tr key={h.symbol} className="border-b border-glass-border/30 last:border-0">
                <td className="px-4 py-3 font-medium text-ink">{h.symbol}</td>
                <td className="tnum px-4 py-3 text-ink-muted">
                  {h.quantity.toLocaleString('en-US')}
                </td>
                <td className="tnum px-4 py-3 text-ink-muted">{money(h.averageCost, currency)}</td>
                <td className="tnum px-4 py-3 text-ink">{money(h.price, currency)}</td>
                <td className="tnum px-4 py-3 text-ink">{money(h.marketValue, currency)}</td>
                <td
                  className={clsx(
                    'tnum px-4 py-3',
                    h.unrealizedPnl >= 0 ? 'text-bull' : 'text-bear',
                  )}
                >
                  {h.unrealizedPnl >= 0 ? '+' : ''}
                  {h.unrealizedPnlPercent.toFixed(2)}%
                </td>
                <td className="tnum px-4 py-3 text-ink-muted">
                  {(h.allocation * 100).toFixed(1)}%
                </td>
                <td className="tnum px-4 py-3 text-right text-ink-faint">{h.heldDays}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {summary.unpriced.length > 0 ? (
        <Card className="divide-y divide-glass-border/50">
          <p className="px-4 py-3 text-xs uppercase tracking-widest text-ink-faint">
            Positions that could not be valued
          </p>
          {summary.unpriced.map((u) => (
            <div key={u.symbol} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">{u.symbol}</p>
                <p className="text-xs text-ink-faint">{u.reason}</p>
              </div>
              <p className="tnum shrink-0 text-sm text-ink-muted">
                {money(u.costBasis, currency)} at cost
              </p>
            </div>
          ))}
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs uppercase tracking-widest text-ink-faint">Diversification</p>
          <p className="tnum mt-1 text-2xl font-semibold text-ink">
            {summary.diversification.score}
            <span className="text-sm text-ink-faint">/100</span>
          </p>
          <ul className="mt-3 space-y-1.5">
            {summary.diversification.notes.map((note, i) => (
              <li key={i} className="text-xs leading-relaxed text-ink-muted">
                {note}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <p className="text-xs uppercase tracking-widest text-ink-faint">Portfolio risk</p>
          <p className="tnum mt-1 text-2xl font-semibold text-ink">
            {summary.risk.score !== undefined ? (
              <>
                {summary.risk.score}
                <span className="text-sm text-ink-faint">/100</span>
              </>
            ) : (
              <span className="text-sm text-ink-muted">not measurable</span>
            )}
          </p>
          <ul className="mt-3 space-y-1.5">
            {summary.risk.notes.map((note, i) => (
              <li key={i} className="text-xs leading-relaxed text-ink-muted">
                {note}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
