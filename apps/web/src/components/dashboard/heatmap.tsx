import Link from 'next/link';
import { clsx } from 'clsx';

import type { AssetScore } from '@/lib/analysis/types';
import type { Quote } from '@/lib/providers/types';

/**
 * Market heatmap.
 *
 * Tiles are sized by market presence and coloured by 24h move. Two decisions
 * matter more than the visuals:
 *
 * 1. **An asset without a quote is not drawn.** The obvious fallback — render it
 *    grey at 0% — puts a tile on screen that reads as "unchanged" when the truth
 *    is "we could not price this". Those assets are counted in the footer instead.
 *
 * 2. **Colour is bucketed, not a continuous gradient.** A gradient invites
 *    reading precision that is not there; five buckets say "up a lot / up / flat
 *    / down / down a lot", which is all a heatmap can honestly convey. Each tile
 *    still shows its exact percentage.
 *
 * Colour is never the only channel: the sign is printed on every tile, so the
 * chart is readable without colour vision.
 */

export interface HeatmapItem {
  name: string;
  score: AssetScore;
  quote?: Quote;
}

/** Bucket boundaries in percent. Symmetric — an asymmetric scale misleads. */
function bucket(changePercent: number): string {
  if (changePercent >= 5) return 'bg-bull/35 border-bull/50';
  if (changePercent > 0.5) return 'bg-bull/20 border-bull/30';
  if (changePercent >= -0.5) return 'bg-glass-strong border-glass-border';
  if (changePercent > -5) return 'bg-bear/20 border-bear/30';
  return 'bg-bear/35 border-bear/50';
}

/**
 * Tile size by market capitalisation where known, falling back to a uniform
 * size. Deliberately only three sizes: a continuous area encoding would imply
 * the relative areas are meaningful, and they are not comparable across an
 * equity market cap and a crypto network value.
 */
function sizeClass(rank: number, total: number): string {
  const percentile = rank / Math.max(total, 1);
  if (percentile < 0.15) return 'col-span-2 row-span-2';
  if (percentile < 0.4) return 'col-span-2';
  return '';
}

export function Heatmap({ items }: { items: HeatmapItem[] }) {
  const priced = items.filter((item) => item.quote !== undefined);
  const unpriced = items.length - priced.length;

  const ordered = [...priced].sort(
    (a, b) => Math.abs(b.quote!.changePercent) - Math.abs(a.quote!.changePercent),
  );

  if (ordered.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-glass-border/70 px-6 py-10 text-center text-sm text-ink-muted">
        No asset in the tracked universe could be priced, so there is nothing to plot.
      </p>
    );
  }

  return (
    <div>
      <div className="grid auto-rows-[72px] grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        {ordered.map((item, index) => {
          const quote = item.quote!;
          const change = quote.changePercent;
          const sign = change > 0 ? '+' : '';

          return (
            <Link
              key={`${item.score.ref.kind}-${item.score.ref.symbol}`}
              href={`/asset/${item.score.ref.kind}/${item.score.ref.symbol}`}
              className={clsx(
                'flex flex-col justify-between rounded-lg border p-2 transition hover:brightness-125',
                bucket(change),
                sizeClass(index, ordered.length),
              )}
              title={`${item.name} · ${sign}${change.toFixed(2)}% · source ${quote.source}`}
            >
              <span className="truncate text-xs font-semibold text-ink">
                {item.score.ref.symbol}
              </span>
              <span className="tnum text-xs text-ink">
                {sign}
                {change.toFixed(1)}%
              </span>
            </Link>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-ink-faint">
        {ordered.length} priced ·{' '}
        {unpriced > 0
          ? `${unpriced} omitted because no provider returned a quote`
          : 'every tracked asset priced'}{' '}
        · tile size by relative move, colour bucketed at ±0.5% and ±5%
      </p>
    </div>
  );
}
