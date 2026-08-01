import type { Recommendation } from '@/lib/analysis/types';
import { formatNumber } from '@/lib/format';
import { Card, InsufficientData, SectionTitle, Stat } from '@/components/ui';
import { RiskBadge } from './verdict';

/**
 * Risk, with its reasoning attached.
 *
 * The label alone would be a judgement; the drivers list is what makes it checkable —
 * every line is a measured number and the threshold it crossed.
 */
export function RiskCard({ rec }: { rec: Recommendation }) {
  return (
    <section>
      <SectionTitle hint="Measured from realised price behaviour">Risk</SectionTitle>

      <Card className="p-5">
        {rec.risk ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <RiskBadge level={rec.risk.level} />
              <span className="text-[11px] text-ink-faint">
                Classified from volatility, drawdown, average true range and size
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat
                label="Annualised volatility"
                value={rec.risk.annualisedVolatility === null ? '—' : `${formatNumber(rec.risk.annualisedVolatility, 0)}%`}
                sub="From 30 sessions of daily returns"
              />
              <Stat
                label="Max drawdown"
                value={rec.risk.maxDrawdown1y === null ? '—' : `${formatNumber(rec.risk.maxDrawdown1y, 0)}%`}
                sub="Worst peak-to-trough in the available history"
              />
              <Stat
                label="Average true range"
                value={rec.risk.atrPercent === null ? '—' : `${formatNumber(rec.risk.atrPercent, 1)}%`}
                sub="Typical single-day span, as a share of price"
              />
            </div>

            <ul className="mt-4 space-y-1.5">
              {rec.risk.drivers.map((driver) => (
                <li key={driver} className="flex gap-2 text-xs leading-relaxed text-ink-muted">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                  <span>{driver}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <InsufficientData what="Risk classification" unavailable={rec.riskUnavailable} />
        )}
      </Card>
    </section>
  );
}
