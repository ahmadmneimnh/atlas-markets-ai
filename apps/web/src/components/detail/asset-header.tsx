import { clsx } from 'clsx';

import type { AssetScore } from '@/lib/analysis/types';
import type { Quote } from '@/lib/providers/types';
import { Card, formatPrice } from '@/components/primitives';

/**
 * The always-visible answer, above everything else on the page.
 *
 * Six facts and no more: name, live price, recommendation, confidence, AI score,
 * last updated. A reader who came to decide something should be able to do it
 * without scrolling, and everything below this is elaboration they chose to open.
 *
 * "Last updated" is the score's own `computedAt`, not the render time. Those
 * differ by the cache TTL, and showing the render time would claim a freshness
 * the number does not have — the single most tempting dishonesty on this screen.
 */
const BAND: Record<AssetScore['recommendation'], { label: string; className: string }> = {
  STRONG_BUY: { label: 'Strong Buy', className: 'border-bull/40 bg-bull/15 text-bull' },
  BUY: { label: 'Buy', className: 'border-bull/25 bg-bull/10 text-bull' },
  HOLD: { label: 'Hold', className: 'border-glass-border bg-glass-strong text-ink-muted' },
  SELL: { label: 'Sell', className: 'border-bear/25 bg-bear/10 text-bear' },
  STRONG_SELL: { label: 'Strong Sell', className: 'border-bear/40 bg-bear/15 text-bear' },
};

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[10px] uppercase tracking-widest text-ink-faint">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function AssetHeader({
  name,
  symbol,
  market,
  score,
  quote,
}: {
  name: string;
  symbol: string;
  market: string;
  score: AssetScore;
  quote?: Quote;
}) {
  const band = BAND[score.recommendation];
  const change = quote?.changePercent;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{symbol}</h1>
            <span className="rounded-md border border-glass-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
              {market}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">{name}</p>
        </div>

        <span
          className={clsx('rounded-full border px-4 py-2 text-sm font-semibold', band.className)}
        >
          {band.label}
        </span>
      </div>

      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-glass-border/40 sm:grid-cols-4">
        <div className="bg-canvas-raised">
          <Stat label="Live price">
            {quote ? (
              <div className="flex items-baseline gap-2">
                <span className="tnum text-xl font-semibold text-ink">
                  {formatPrice(quote.price)}
                </span>
                {change !== undefined ? (
                  <span
                    className={clsx(
                      'tnum text-xs',
                      change > 0 ? 'text-bull' : change < 0 ? 'text-bear' : 'text-ink-muted',
                    )}
                  >
                    {change > 0 ? '+' : ''}
                    {change.toFixed(2)}%
                  </span>
                ) : null}
              </div>
            ) : (
              <span className="text-sm text-ink-faint">Unavailable</span>
            )}
          </Stat>
        </div>

        <div className="bg-canvas-raised">
          <Stat label="AI score">
            <span className="tnum text-xl font-semibold text-gold">
              {score.score.toFixed(0)}
              <span className="text-xs text-ink-faint">/100</span>
            </span>
          </Stat>
        </div>

        <div className="bg-canvas-raised">
          <Stat label="Confidence">
            <span className="tnum text-xl font-semibold text-ink">
              {score.confidence.toFixed(0)}
              <span className="text-xs text-ink-faint">%</span>
            </span>
          </Stat>
        </div>

        <div className="bg-canvas-raised">
          <Stat label="Last updated">
            <time
              dateTime={score.computedAt.toISOString()}
              className="tnum text-sm text-ink-muted"
              // The score's own timestamp, not the render time. They differ by
              // the cache TTL, and the render time would overstate freshness.
              title={score.computedAt.toISOString()}
            >
              {score.computedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
            </time>
          </Stat>
        </div>
      </Card>

      <p className="text-xs text-ink-faint">
        Scored from {score.sources.length} provider{score.sources.length === 1 ? '' : 's'} (
        {score.sources.join(', ')}). Score and confidence are independent: the first says how the
        asset looks, the second how much was actually known.
      </p>
    </section>
  );
}
