import Link from 'next/link';
import { clsx } from 'clsx';
import type { AssetScore } from '@/lib/analysis/types';
import type { Quote } from '@/lib/providers/types';
import {
  Card,
  RecommendationBadge,
  ScoreDial,
  Delta,
  DirectionDot,
  Provenance,
  formatPrice,
  SectionTitle,
} from './primitives';

/** Compact card for grids — dashboard, screener, watchlist. */
export function AssetScoreCard({
  name,
  score,
  quote,
}: {
  name: string;
  score: AssetScore;
  quote?: Quote;
}) {
  const href = `/asset/${score.ref.kind}/${score.ref.symbol}`;

  return (
    <Link href={href} className="block">
      <Card hover className="h-full p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-semibold tracking-tight">
                {score.ref.symbol}
              </span>
              <span className="rounded border border-glass-border px-1.5 py-px text-[9px] uppercase tracking-wider text-ink-faint">
                {score.ref.market}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-faint">{name}</p>
          </div>
          <RecommendationBadge recommendation={score.recommendation} size="sm" />
        </div>

        <div className="flex items-center gap-4">
          <ScoreDial score={score.score} size={78} />

          <div className="min-w-0 flex-1">
            {quote ? (
              <>
                <div className="tnum text-lg font-semibold">
                  {quote.currency === 'USD' || quote.currency === 'USDT' ? '$' : ''}
                  {formatPrice(quote.price)}
                </div>
                <Delta value={quote.changePercent} />
                <div className="mt-1.5">
                  <Provenance source={quote.source} asOf={quote.asOf} />
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-faint">Price unavailable</p>
            )}
          </div>
        </div>

        {/* Confidence is shown next to the score, never folded into it. */}
        <div className="mt-4 border-t border-glass-border/60 pt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-ink-faint">Confidence</span>
            <span
              className={clsx(
                'tnum font-medium',
                score.confidence < 40 ? 'text-warn' : 'text-ink-muted',
              )}
            >
              {score.confidence}%
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-glass-strong">
            <div
              className={clsx(
                'h-full rounded-full',
                score.confidence < 40 ? 'bg-warn/70' : 'bg-gold/70',
              )}
              style={{ width: `${score.confidence}%` }}
            />
          </div>
        </div>

        {score.topReasons.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {score.topReasons.slice(0, 2).map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-[11px] text-ink-muted">
                <DirectionDot direction={r.direction} />
                <span className="truncate">{r.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </Link>
  );
}

/**
 * Full recommendation explanation. This is the component that discharges the
 * product's central promise: every reason shown carries the value that produced it
 * and the provider it came from, and factors that could not be scored are listed
 * explicitly rather than quietly omitted.
 */
export function ScoreExplanation({ score }: { score: AssetScore }) {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-6">
          <ScoreDial score={score.score} size={132} />

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-3">
              <RecommendationBadge recommendation={score.recommendation} size="lg" />
              <span className="tnum text-sm text-ink-muted">Confidence {score.confidence}%</span>
            </div>

            {score.confidence < 40 ? (
              <p className="mb-3 rounded-lg border border-warn/25 bg-warn/8 px-3 py-2 text-xs leading-relaxed text-warn">
                Low confidence — this score rests on limited evidence. Review the omitted factors
                below before acting on it.
              </p>
            ) : null}

            <p className="text-xs text-ink-faint">
              Computed {score.computedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC from{' '}
              {score.sources.length} data {score.sources.length === 1 ? 'source' : 'sources'}:{' '}
              <span className="text-ink-muted">{score.sources.join(', ')}</span>
            </p>
          </div>
        </div>
      </Card>

      {/* Why */}
      <div>
        <SectionTitle hint="ranked by contribution to the final score">
          Why this rating
        </SectionTitle>
        <Card className="divide-y divide-glass-border/50">
          {score.topReasons.length === 0 ? (
            <p className="p-5 text-sm text-ink-faint">
              No directional signals — every available indicator read neutral.
            </p>
          ) : (
            score.topReasons.map((r, i) => (
              <div key={i} className="flex items-start gap-3 p-4">
                <DirectionDot direction={r.direction} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{r.label}</p>
                  <p className="tnum mt-0.5 text-xs text-ink-muted">{r.value}</p>
                </div>
                <Provenance source={r.source} />
              </div>
            ))
          )}
        </Card>
      </div>

      {/* Factor breakdown */}
      <div>
        <SectionTitle hint="weights renormalized across available factors">
          Factor breakdown
        </SectionTitle>
        <Card className="divide-y divide-glass-border/50">
          {score.breakdown.map((b) => (
            <details key={b.factor} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-4 p-4 transition-colors hover:bg-glass">
                <span className="w-28 shrink-0 text-sm font-medium capitalize">{b.factor}</span>

                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-glass-strong">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold"
                    style={{ width: `${Math.max(0, Math.min(100, b.score))}%` }}
                  />
                </div>

                <span className="tnum w-12 shrink-0 text-right text-sm font-semibold">
                  {b.score.toFixed(0)}
                </span>
                <span className="tnum w-16 shrink-0 text-right text-xs text-ink-faint">
                  {b.effectiveWeight.toFixed(0)}% wt
                </span>
                <svg
                  className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="m6 9 6 6 6-6" strokeLinecap="round" />
                </svg>
              </summary>

              <div className="space-y-2 bg-canvas-sunken/40 px-4 pb-4 pt-1">
                {b.nominalWeight !== b.effectiveWeight ? (
                  <p className="pb-1 text-[11px] text-ink-faint">
                    Nominal weight {b.nominalWeight}% → {b.effectiveWeight.toFixed(1)}% after
                    renormalizing across available factors.
                  </p>
                ) : null}
                {b.signals.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-lg border border-glass-border/40 p-2.5"
                  >
                    <DirectionDot direction={s.direction} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-ink-muted">{s.label}</p>
                      <p className="tnum mt-0.5 text-[11px] text-ink-faint">{s.value}</p>
                    </div>
                    <Provenance source={s.source} />
                  </div>
                ))}
              </div>
            </details>
          ))}
        </Card>
      </div>

      {/* What we could not score — deliberately prominent, not hidden */}
      {score.omitted.length > 0 ? (
        <div>
          <SectionTitle hint="excluded from the score, not estimated">
            Factors not scored
          </SectionTitle>
          <Card className="divide-y divide-glass-border/50">
            {score.omitted.map((o) => (
              <div key={o.factor} className="flex items-start gap-3 p-4">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-glass-border text-[10px] text-ink-faint">
                  –
                </span>
                <div>
                  <p className="text-sm font-medium capitalize text-ink-muted">{o.factor}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{o.reason}</p>
                </div>
              </div>
            ))}
          </Card>
          <p className="mt-3 px-1 text-xs leading-relaxed text-ink-faint">
            These factors contributed nothing to the score. Their weight was redistributed across
            the factors that had data — they were not assigned a neutral value, because a neutral
            value would be a number no evidence supports.
          </p>
        </div>
      ) : null}
    </div>
  );
}
