import { Suspense } from 'react';
import Link from 'next/link';

import { runDailyScan } from '@/lib/service';
import { ACTIONABLE_CONFIDENCE, type Opportunity } from '@/lib/scanner/rank';
import { Card, SectionTitle, Unavailable, formatPrice } from '@/components/primitives';

/**
 * The daily AI market scanner.
 *
 * Every tracked stock and cryptocurrency in one ranking, strongest buy at the top
 * and strongest sell at the bottom. Unlike the homepage's live top-five, this is
 * the complete list and it is stable for the UTC day — see `runDailyScan` for why
 * a ranking you can work through beats one that reshuffles under the cursor.
 *
 * Three things the table refuses to do:
 *
 *  - **Renumber around low-confidence rows.** An asset the engine could score but
 *    not defend keeps its rank and is marked. Filtering it out would present a
 *    subset as the whole universe.
 *  - **Show a target where none was derived.** The cell says so rather than
 *    holding a dash that reads like zero.
 *  - **Imply the prices are live.** The scan timestamp is stated at the top, and
 *    a row's price is the price at scan time.
 */
export const metadata = {
  title: 'Daily AI Market Scanner — Atlas Markets AI',
};

export const dynamic = 'force-dynamic';

export default function ScannerPage() {
  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Daily AI Market Scanner</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Every tracked stock and cryptocurrency, ranked from strongest buy to strongest sell. One
          ranking for the day, so a list read at nine still matches the list read at three.
        </p>
      </header>

      <Suspense fallback={<ScannerSkeleton />}>
        <ScannerTable />
      </Suspense>
    </div>
  );
}

async function ScannerTable() {
  const { result, scanDate } = await runDailyScan('all');
  const { ranked, coverage } = result;

  if (ranked.length === 0) {
    return (
      <Unavailable
        title="Nothing could be ranked"
        reason={`None of the ${coverage.attempted} tracked assets could be scored — no configured provider returned data.`}
        hint="cp .env.example .env → add FINNHUB_API_KEY"
      />
    );
  }

  return (
    <section>
      <SectionTitle
        hint={`${coverage.scored} of ${coverage.attempted} assets scored · computed ${result.scannedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`}
      >
        Ranking for {scanDate}
      </SectionTitle>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[62rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-glass-border/60 text-left">
              <Th className="w-12">#</Th>
              <Th>Asset</Th>
              <Th className="text-right">Price</Th>
              <Th>Recommendation</Th>
              <Th className="text-right">AI score</Th>
              <Th className="text-right">Confidence</Th>
              <Th className="text-right">Potential</Th>
              <Th>Risk</Th>
              <Th>Sources</Th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((opportunity, index) => (
              <Row
                key={`${opportunity.kind}-${opportunity.symbol}`}
                rank={index + 1}
                opportunity={opportunity}
              />
            ))}
          </tbody>
        </table>
      </Card>

      <p className="mt-3 px-1 text-xs leading-relaxed text-ink-faint">
        Prices are as at the scan timestamp above, not live. Rows below {ACTIONABLE_CONFIDENCE}%
        confidence keep their rank and are marked — they were scored, but on evidence too thin to
        act on. Open any asset for the signals and providers behind its score.
      </p>
    </section>
  );
}

function Row({ rank, opportunity }: { rank: number; opportunity: Opportunity }) {
  const thin = opportunity.confidence < ACTIONABLE_CONFIDENCE;
  const potential = opportunity.potentialPercent;

  return (
    <tr className="border-b border-glass-border/30 transition-colors last:border-0 hover:bg-glass">
      <Td className="tnum text-ink-faint">{rank}</Td>
      <Td>
        <Link
          href={`/asset/${opportunity.kind}/${encodeURIComponent(opportunity.symbol)}`}
          className="group block rounded focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <span className="block font-medium text-ink group-hover:text-gold">
            {opportunity.symbol}
          </span>
          <span className="block truncate text-xs text-ink-faint">{opportunity.name}</span>
        </Link>
      </Td>
      <Td className="tnum text-right">
        {opportunity.price === undefined ? (
          <span className="text-xs text-ink-faint">unavailable</span>
        ) : (
          formatPrice(opportunity.price)
        )}
      </Td>
      <Td>
        <span className="text-xs font-medium uppercase tracking-wider">
          {opportunity.recommendation.replace('_', ' ').toLowerCase()}
        </span>
      </Td>
      <Td className="tnum text-right font-semibold text-gold">{opportunity.score.toFixed(0)}</Td>
      <Td className="tnum text-right">
        <span className={thin ? 'text-warn' : 'text-ink'}>
          {opportunity.confidence.toFixed(0)}%
        </span>
        {thin ? <span className="ml-1.5 text-[10px] uppercase text-warn">thin</span> : null}
      </Td>
      <Td className="tnum text-right">
        {potential === undefined ? (
          <span className="text-xs text-ink-faint">no target</span>
        ) : (
          <span
            className={potential > 0 ? 'text-bull' : potential < 0 ? 'text-bear' : 'text-ink-muted'}
          >
            {potential > 0 ? '+' : ''}
            {potential.toFixed(1)}%
          </span>
        )}
      </Td>
      <Td>
        <span className="text-xs capitalize text-ink-muted">{opportunity.riskLevel ?? '—'}</span>
      </Td>
      <Td>
        {/* Every row is a recommendation, so every row carries its attribution.
            A ranking table is where an unsourced number is easiest to skim past. */}
        <span className="text-[10px] uppercase tracking-wider text-ink-faint">
          {opportunity.providers.length > 0 ? (
            opportunity.providers.join(', ')
          ) : (
            <span className="text-warn">none recorded</span>
          )}
        </span>
      </Td>
    </tr>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-3 text-[10px] font-medium uppercase tracking-widest text-ink-faint ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

function ScannerSkeleton() {
  return (
    <div aria-busy="true" aria-label="Ranking the market">
      <div className="skeleton mb-3 h-4 w-56" />
      <div className="space-y-2">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="skeleton h-12 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
