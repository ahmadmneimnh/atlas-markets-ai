import { clsx } from 'clsx';

import type { EarningsEvent, EconomicEvent, NewsArticle } from '@/lib/providers/types';

/**
 * Calendar and news lists for the dashboard.
 *
 * Shared rule across all three: a field the provider did not supply renders as
 * an em dash, never as 0 or "—0.00". An estimate of zero and a missing estimate
 * are different facts, and on an earnings row the difference is the whole point.
 */

function dayLabel(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const HOUR_LABEL: Record<string, string> = {
  bmo: 'before open',
  amc: 'after close',
  dmh: 'during hours',
};

export function EarningsList({ events }: { events: EarningsEvent[] }) {
  return (
    <ul className="divide-y divide-glass-border/50">
      {events.map((event) => (
        <li
          key={`${event.symbol}-${event.date.toISOString()}`}
          className="flex items-center justify-between gap-4 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{event.symbol}</p>
            <p className="text-xs text-ink-faint">
              {dayLabel(event.date)}
              {event.hour ? ` · ${HOUR_LABEL[event.hour]}` : ''}
              {event.quarter && event.year ? ` · Q${event.quarter} ${event.year}` : ''}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="tnum text-sm text-ink">
              {event.epsActual !== undefined
                ? event.epsActual.toFixed(2)
                : event.epsEstimate !== undefined
                  ? event.epsEstimate.toFixed(2)
                  : '—'}
            </p>
            <p className="text-xs text-ink-faint">
              {/* Labelled, because "1.20 reported" and "1.20 expected" are
                  different claims and the number alone cannot distinguish them. */}
              {event.epsActual !== undefined
                ? 'EPS reported'
                : event.epsEstimate !== undefined
                  ? 'EPS estimate'
                  : 'no estimate published'}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const IMPACT_STYLE: Record<string, string> = {
  high: 'bg-bear/20 text-bear border-bear/30',
  medium: 'bg-warn/20 text-warn border-warn/30',
  low: 'bg-glass-strong text-ink-muted border-glass-border',
};

export function EconomicList({ events }: { events: EconomicEvent[] }) {
  return (
    <ul className="divide-y divide-glass-border/50">
      {events.map((event) => (
        <li key={event.id} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{event.event}</p>
            <p className="text-xs text-ink-faint">
              {event.country} ·{' '}
              {event.time.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'UTC',
              })}{' '}
              UTC
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="text-right">
              <p className="tnum text-sm text-ink">
                {event.actual !== undefined
                  ? `${event.actual}${event.unit ?? ''}`
                  : event.estimate !== undefined
                    ? `${event.estimate}${event.unit ?? ''}`
                    : '—'}
              </p>
              <p className="text-xs text-ink-faint">
                {event.actual !== undefined
                  ? 'actual'
                  : event.estimate !== undefined
                    ? 'forecast'
                    : 'no forecast'}
              </p>
            </div>
            {event.impact ? (
              <span
                className={clsx(
                  'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
                  IMPACT_STYLE[event.impact],
                )}
              >
                {event.impact}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function NewsList({ articles }: { articles: NewsArticle[] }) {
  return (
    <ul className="divide-y divide-glass-border/50">
      {articles.map((article) => (
        <li key={article.id}>
          <a
            href={article.url}
            target="_blank"
            // noreferrer as well as noopener: the referrer would otherwise tell
            // every outlet which Atlas page a reader came from.
            rel="noopener noreferrer"
            className="block px-4 py-3 transition hover:bg-glass-strong"
          >
            <p className="line-clamp-2 text-sm text-ink">{article.headline}</p>
            <p className="mt-1 text-xs text-ink-faint">
              {article.outlet} ·{' '}
              {article.publishedAt.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              })}{' '}
              · via {article.source}
            </p>
          </a>
        </li>
      ))}
    </ul>
  );
}
