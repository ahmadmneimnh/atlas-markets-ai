import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { scanMarket, type ScanEntry, type ScanResult } from '@/lib/analysis/scanner';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';
import { explainUnavailable } from '@/lib/dto';
import { Badge, Card, InsufficientData, SectionTitle, Stat } from '@/components/ui';
import { RiskBadge, VerdictBadge } from '@/components/analysis/verdict';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: "Scanner — Batal's Brain" };

/**
 * The scanner runs the full engine across every tracked asset, so it is streamed
 * behind a Suspense boundary rather than blocking the page shell.
 */
export default function ScannerPage() {
  return (
    <div className="animate-fade-up space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Scanner</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Every tracked asset run through the same analysis engine as the asset pages, ranked by
          what the evidence supports. Assets whose data could not be read are listed at the bottom
          with the reason rather than dropped.
        </p>
      </section>

      <Suspense fallback={<ScannerSkeleton />}>
        <ScanResults />
      </Suspense>
    </div>
  );
}

async function ScanResults() {
  const scan = await scanMarket();

  const analysed = scan.entries.length;
  const buys = scan.entries.filter((e) => e.action === 'BUY').length;
  const sells = scan.entries.filter((e) => e.action === 'SELL').length;

  return (
    <>
      <section>
        <SectionTitle hint={`scanned ${new Date(scan.scannedAt).toISOString().slice(11, 16)} UTC`}>
          Overview
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Assets analysed" value={analysed} sub={`${scan.skipped.length} could not be analysed`} />
          <Stat label="Buy verdicts" value={<span className="text-bull">{buys}</span>} />
          <Stat label="Sell verdicts" value={<span className="text-bear">{sells}</span>} />
          <Stat
            label="Crypto regime"
            value={scan.context.crypto?.label ?? '—'}
            sub={scan.context.crypto?.basis[0] ?? scan.context.cryptoUnavailable?.detail}
          />
        </div>
      </section>

      {analysed === 0 ? (
        <Card className="p-0">
          <InsufficientData
            what="Scanner results"
            message="No tracked asset had enough live data for the engine to reach a verdict. Every asset and its reason is listed below."
            hint="Check /api/health to see which providers are configured."
          />
        </Card>
      ) : (
        <div className="space-y-8">
          <Group
            title="Top buy opportunities"
            hint="Highest conviction with a Buy verdict"
            entries={scan.topBuys}
            empty="Nothing in the tracked list currently scores a Buy."
          />
          <Group
            title="Top sell warnings"
            hint="Lowest conviction with a Sell verdict"
            entries={scan.topSells}
            empty="Nothing in the tracked list currently scores a Sell."
          />
          <Group
            title="Strongest momentum"
            hint="Ranked by 20-session price change"
            entries={scan.strongestMomentum}
            empty="No asset had enough history to measure momentum."
            column="momentum"
          />
          <Group
            title="Strongest reversals"
            hint="A turn on the latest bar, not a stretched level"
            entries={scan.strongestReversals}
            empty="No fresh crossover or oversold exit across the tracked list."
            column="reversal"
          />
          <Group
            title="Holds worth watching"
            hint="Closest to neutral — the evidence does not favour either side yet"
            entries={scan.topHolds}
            empty="No asset currently scores a Hold."
          />
        </div>
      )}

      {scan.skipped.length > 0 ? (
        <section>
          <SectionTitle hint="reported, not hidden">Could not be analysed</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {scan.skipped.map((s) => (
                <li key={`${s.kind}-${s.symbol}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                  <span className="w-16 shrink-0 text-sm font-semibold text-ink">{s.symbol}</span>
                  <span className="text-xs text-ink-muted">{s.name}</span>
                  <span className="ml-auto text-[11px] uppercase tracking-wider text-ink-faint">
                    Insufficient Data
                  </span>
                  <p className="w-full text-[11px] leading-relaxed text-ink-faint">
                    {explainUnavailable(s.unavailable)}
                    {s.unavailable.detail ? ` (${s.unavailable.detail})` : null}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </>
  );
}

function Group({
  title,
  hint,
  entries,
  empty,
  column,
}: {
  title: string;
  hint: string;
  entries: ScanEntry[];
  empty: string;
  column?: 'momentum' | 'reversal';
}) {
  return (
    <section>
      <SectionTitle hint={hint}>{title}</SectionTitle>
      {entries.length === 0 ? (
        <Card className="px-4 py-5">
          <p className="text-xs text-ink-faint">{empty}</p>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <li key={`${e.kind}-${e.symbol}`}>
                <Link
                  href={`/asset/${e.kind}/${encodeURIComponent(e.symbol)}`}
                  className="block px-4 py-3 transition-colors hover:bg-canvas"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="text-sm font-semibold text-ink">{e.symbol}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{e.name}</span>

                    {column === 'momentum' ? (
                      <span className={`tnum text-sm ${(e.momentum20 ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                        {e.momentum20 === null ? '—' : formatPercent(e.momentum20)}
                      </span>
                    ) : null}

                    <span className="tnum text-xs text-ink-muted">{formatCurrency(e.price)}</span>
                    <span className="tnum text-xs text-ink-faint">{formatNumber(e.conviction, 0)}/100</span>
                    <VerdictBadge verdict={e.verdict} size="sm" />
                    {e.risk ? <RiskBadge level={e.risk.level} size="sm" /> : <Badge>Risk unmeasured</Badge>}
                  </div>

                  <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                    {column === 'reversal' && e.reversal ? e.reversal.note : e.headline}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function ScannerSkeleton() {
  return (
    <div className="space-y-4">
      <Card className="px-4 py-5">
        <p className="text-xs text-ink-muted">
          Running every tracked asset through the analysis modules — this takes a few seconds on the
          first load, then it is cached for five minutes.
        </p>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-[76px]" />
        ))}
      </div>
      <div className="skeleton h-64" />
    </div>
  );
}

export type { ScanResult };
