import Link from 'next/link';
import { clsx } from 'clsx';

import type { AssetScore } from '@/lib/analysis/types';
import type { Quote } from '@/lib/providers/types';
import { formatPrice } from '@/components/primitives';

export { volumeRatioOf } from '@/lib/dashboard/trending';

/**
 * "Trending" needs a definition, or it is just a ranking someone made up.
 *
 * Here it means **unusual trading activity**: today's volume against the asset's
 * own 20-bar average, which the technical factor already computes and cites as
 * `Volume vs 20-bar average`. Ranking by raw volume instead would return the same
 * mega-caps every day, which is a leaderboard, not a trend.
 *
 * Because the ratio is read out of the scoring signals, every row is traceable to
 * the provider that supplied the underlying candles — and an asset whose volume
 * signal is missing is **excluded rather than ranked at zero**. A missing ratio
 * means "we could not measure activity", not "there was none".
 */

export interface TrendingItem {
  name: string;
  score: AssetScore;
  quote?: Quote;
  /** Multiple of the 20-bar average, parsed from the cited signal. */
  volumeRatio: number;
  source: string;
}

export function TrendingList({ items }: { items: TrendingItem[] }) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-6 text-xs leading-relaxed text-ink-faint">
        No asset in this class had a measurable volume ratio — that requires OHLCV history from a
        configured provider. Nothing is ranked rather than ranking on an assumed value.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-glass-border/50">
      {items.map((item) => {
        const change = item.quote?.changePercent;
        return (
          <li key={`${item.score.ref.kind}-${item.score.ref.symbol}`}>
            <Link
              href={`/asset/${item.score.ref.kind}/${item.score.ref.symbol}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-glass-strong"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{item.score.ref.symbol}</p>
                <p className="truncate text-xs text-ink-faint">{item.name}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tnum text-sm text-gold">{item.volumeRatio.toFixed(1)}× volume</p>
                <p className="text-xs text-ink-faint">
                  {item.quote ? (
                    <>
                      <span className="tnum">{formatPrice(item.quote.price)}</span>
                      {change !== undefined ? (
                        <span
                          className={clsx(
                            'tnum ml-2',
                            change > 0 ? 'text-bull' : change < 0 ? 'text-bear' : 'text-ink-muted',
                          )}
                        >
                          {change > 0 ? '+' : ''}
                          {change.toFixed(2)}%
                        </span>
                      ) : null}
                    </>
                  ) : (
                    'no quote'
                  )}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
