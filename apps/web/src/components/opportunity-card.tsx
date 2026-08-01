import Link from 'next/link';
import { clsx } from 'clsx';

import type { Opportunity } from '@/lib/scanner/rank';
import { formatPrice } from '@/components/primitives';

/**
 * The asset card, reduced to six fields: name, symbol, price, recommendation,
 * confidence and AI score.
 *
 * Everything else that could go here — factor breakdowns, sparklines, volume,
 * provenance — belongs on the detail page. A card carrying nine numbers is not
 * scannable, and a list of them is a spreadsheet rather than a decision aid.
 *
 * Score and confidence stay visually distinct rather than being merged into one
 * badge. They answer different questions: how good does this look, and how much
 * did we actually know. Collapsing them is the single most misleading
 * simplification available on this screen.
 */

const BAND_STYLE: Record<Opportunity['recommendation'], string> = {
  STRONG_BUY: 'border-bull/40 bg-bull/15 text-bull',
  BUY: 'border-bull/25 bg-bull/10 text-bull',
  HOLD: 'border-glass-border bg-glass-strong text-ink-muted',
  SELL: 'border-bear/25 bg-bear/10 text-bear',
  STRONG_SELL: 'border-bear/40 bg-bear/15 text-bear',
};

const BAND_LABEL: Record<Opportunity['recommendation'], string> = {
  STRONG_BUY: 'Strong Buy',
  BUY: 'Buy',
  HOLD: 'Hold',
  SELL: 'Sell',
  STRONG_SELL: 'Strong Sell',
};

export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const { recommendation, changePercent } = opportunity;

  return (
    <Link
      href={`/asset/${opportunity.kind}/${encodeURIComponent(opportunity.symbol)}`}
      className="glass glass-hover group flex flex-col rounded-2xl p-5 focus-visible:ring-2 focus-visible:ring-gold/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{opportunity.symbol}</p>
          <p className="truncate text-xs text-ink-faint">{opportunity.name}</p>
        </div>
        <span
          className={clsx(
            'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium',
            BAND_STYLE[recommendation],
          )}
        >
          {BAND_LABEL[recommendation]}
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        {opportunity.price !== undefined ? (
          <>
            <span className="tnum text-xl font-semibold text-ink">
              {formatPrice(opportunity.price)}
            </span>
            {changePercent !== undefined ? (
              <span
                className={clsx(
                  'tnum text-xs',
                  changePercent > 0
                    ? 'text-bull'
                    : changePercent < 0
                      ? 'text-bear'
                      : 'text-ink-muted',
                )}
              >
                {changePercent > 0 ? '+' : ''}
                {changePercent.toFixed(2)}%
              </span>
            ) : null}
          </>
        ) : (
          // Never a zero or a dash styled like a number — an unpriced asset says
          // so in words, because a 0.00 reads as a real and catastrophic price.
          <span className="text-sm text-ink-faint">Price unavailable</span>
        )}
      </div>

      <div className="mt-4 flex items-end justify-between gap-4 border-t border-glass-border/60 pt-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink-faint">AI score</p>
          <p className="tnum text-lg font-semibold text-gold">
            {opportunity.score.toFixed(0)}
            <span className="text-xs text-ink-faint">/100</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest text-ink-faint">Confidence</p>
          <p className="tnum text-lg font-semibold text-ink">
            {opportunity.confidence.toFixed(0)}
            <span className="text-xs text-ink-faint">%</span>
          </p>
        </div>
      </div>
    </Link>
  );
}
