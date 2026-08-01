import type { NewsSummary } from '@/lib/analysis/news-summary';
import { Card } from '@/components/primitives';

/**
 * The market summary that replaces a scrolling news feed.
 *
 * Every sentence here comes from a measurement the news factor produced — see
 * `lib/analysis/news-summary.ts` for why that matters. The source links are not
 * decoration: they are what makes the summary checkable, and a summary nobody
 * can check is indistinguishable from one that was invented.
 */
export function NewsSummaryPanel({ summary }: { summary: NewsSummary }) {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <p className="text-sm leading-relaxed text-ink">{summary.headline}</p>

        {summary.points.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {summary.points.map((point, index) => (
              <li key={index} className="text-xs leading-relaxed text-ink-muted">
                {point}
              </li>
            ))}
          </ul>
        ) : null}

        {summary.confidence !== undefined ? (
          <p className="mt-4 border-t border-glass-border/60 pt-3 text-xs text-ink-faint">
            Classifier confidence {Math.round(summary.confidence * 100)}%
          </p>
        ) : null}

        {summary.caveat ? (
          <p className="mt-2 rounded-lg border border-warn/25 bg-warn/[0.06] px-3 py-2 text-xs leading-relaxed text-ink-muted">
            {summary.caveat}
          </p>
        ) : null}
      </Card>

      {summary.sources.length > 0 ? (
        <Card className="divide-y divide-glass-border/50">
          <p className="px-4 py-2.5 text-[10px] uppercase tracking-widest text-ink-faint">
            Sources — read the originals
          </p>
          {summary.sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              // noreferrer as well as noopener: the referrer would otherwise tell
              // every outlet which Atlas page a reader came from.
              rel="noopener noreferrer"
              className="block px-4 py-2.5 transition-colors hover:bg-glass"
            >
              <p className="line-clamp-2 text-sm leading-snug text-ink">{source.title}</p>
              <p className="mt-1 text-[11px] text-ink-faint">
                {source.outlet} · {source.publishedAt.toISOString().slice(0, 10)}
              </p>
            </a>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
