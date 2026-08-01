import type { Recommendation } from '@/lib/analysis/types';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Card, InsufficientData, SectionTitle, Stat } from '@/components/ui';
import { ConfidenceLabel, ConvictionDial, ProbabilityBar, VerdictBadge } from './verdict';

/**
 * The headline card: what the engine concluded, how strongly, and the levels that
 * follow from it.
 *
 * The disclaimer under the levels is not boilerplate — the entry, stop and target
 * are arithmetic on measured volatility and pivots, and a reader who mistakes them
 * for a forecast is misreading the one part of this page most likely to be acted on.
 */
export function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <section>
      <SectionTitle hint={`${formatNumber(rec.confidenceScore * 100, 0)}% confidence score`}>
        Recommendation
      </SectionTitle>

      <Card className="p-5">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
          {/* min-w-0 lets the summary text wrap instead of pushing the probability
              block down to a few pixels wide. */}
          <div className="flex min-w-0 flex-1 items-center gap-5">
            <ConvictionDial conviction={rec.conviction} action={rec.action} />
            <div className="min-w-0 space-y-2">
              <VerdictBadge verdict={rec.verdict} size="lg" />
              <p className="text-xs leading-relaxed text-ink-muted">{rec.summary}</p>
            </div>
          </div>

          <div className="w-full lg:w-72 lg:shrink-0">
            <ProbabilityBar probabilities={rec.probabilities} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Confidence" value={<ConfidenceLabel confidence={rec.confidence} />} sub="From data coverage and module agreement" />
          <Stat label="Horizon" value={rec.horizon} sub="How long the evidence should hold" />
          <Stat
            label="Conviction"
            value={`${formatNumber(rec.conviction, 0)} / 100`}
            sub="Weighted across available modules"
          />
          <Stat
            label="Reward : risk"
            value={rec.levels ? `${formatNumber(rec.levels.rewardRisk, 2)} : 1` : '—'}
            sub={rec.levels ? 'From the levels below' : 'Needs price history'}
          />
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          <span className="font-medium text-ink-muted">Horizon:</span> {rec.horizonReason}
        </p>

        <div className="mt-5 border-t border-line pt-5">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Suggested levels
          </h3>

          {rec.levels ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Level
                  label="Entry zone"
                  value={`${formatCurrency(rec.levels.entryLow, rec.currency)} – ${formatCurrency(rec.levels.entryHigh, rec.currency)}`}
                  tone="neutral"
                />
                <Level label="Stop loss" value={formatCurrency(rec.levels.stopLoss, rec.currency)} tone="bear" />
                <Level label="Target" value={formatCurrency(rec.levels.target, rec.currency)} tone="bull" />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
                {rec.levels.basis} Levels are framed for the long side and derived from measured
                volatility and pivot structure — they describe where this thesis would be confirmed
                or invalidated, not a prediction of where price will go.
              </p>
            </>
          ) : (
            <InsufficientData what="Entry, stop and target" unavailable={rec.levelsUnavailable} />
          )}
        </div>
      </Card>
    </section>
  );
}

function Level({ label, value, tone }: { label: string; value: string; tone: 'bull' | 'bear' | 'neutral' }) {
  const color = tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : 'text-ink';
  return (
    <div className="rounded-lg border border-line bg-canvas px-3.5 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`tnum mt-1 text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}
