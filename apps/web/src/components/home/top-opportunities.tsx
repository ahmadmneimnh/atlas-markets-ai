import { runScanner } from '@/lib/service';
import { OpportunityCard } from '@/components/opportunity-card';
import { Unavailable } from '@/components/primitives';
import type { Opportunity } from '@/lib/scanner/rank';

/**
 * Today's top opportunities.
 *
 * Three groups in the order a decision gets made: what to buy, what to hold,
 * what to sell. Each is ranked by AI score — buys and holds descending, sells
 * ascending so the strongest sell signal leads rather than trailing.
 *
 * Rendered inside a Suspense boundary on the homepage. Scoring the universe
 * takes seconds against live providers; without streaming, the search bar —
 * which needs nothing — would be blocked behind it, and the page's entire
 * purpose is to be typed into immediately.
 */
const GROUPS = [
  {
    key: 'buy' as const,
    title: 'Best buying opportunities',
    hint: 'Strong Buy and Buy, highest AI score first',
  },
  { key: 'hold' as const, title: 'Hold', hint: 'closest to becoming a buy' },
  {
    key: 'sell' as const,
    title: 'Strongest sell signals',
    hint: 'Sell and Strong Sell, lowest AI score first',
  },
];

function Group({ title, hint, items }: { title: string; hint: string; items: Opportunity[] }) {
  if (items.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-muted">
          {title}
        </h3>
        <span className="text-xs text-ink-faint">{hint}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {items.map((opportunity) => (
          <OpportunityCard
            key={`${opportunity.kind}-${opportunity.symbol}`}
            opportunity={opportunity}
          />
        ))}
      </div>
    </section>
  );
}

export async function TopOpportunities() {
  const result = await runScanner('all', 5);
  const { coverage } = result;
  const total = result.buy.length + result.hold.length + result.sell.length;

  if (total === 0) {
    return (
      <Unavailable
        title="No opportunities could be ranked"
        reason={
          coverage.scored === 0
            ? `None of the ${coverage.attempted} tracked assets could be scored — no configured provider returned data.`
            : `${coverage.scored} of ${coverage.attempted} assets scored, but none reached the confidence needed to be actionable.`
        }
        hint="cp .env.example .env → add FINNHUB_API_KEY"
      />
    );
  }

  return (
    <div className="space-y-10">
      {GROUPS.map((group) => (
        <Group key={group.key} title={group.title} hint={group.hint} items={result[group.key]} />
      ))}

      {/* Coverage is stated, not implied. "3 of 30 scored" and "30 of 30" are
          very different answers, and a list that hides which one it is invites
          being read as the whole market. */}
      <p className="text-xs text-ink-faint">
        Ranked from {coverage.scored} of {coverage.attempted} tracked assets ·{' '}
        {result.lowConfidence.length > 0
          ? `${result.lowConfidence.length} scored but held back below 45% confidence · `
          : ''}
        every score cites the signals and providers behind it — open any card to see them
      </p>
    </div>
  );
}

/** Shown while the scan runs. Shapeless on purpose: a skeleton shaped like a
 *  price invites reading a value that does not exist yet. */
export function TopOpportunitiesSkeleton() {
  return (
    <div className="space-y-10" aria-busy="true" aria-label="Scanning the market">
      {[0, 1].map((group) => (
        <div key={group}>
          <div className="skeleton mb-3 h-4 w-48" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((card) => (
              <div key={card} className="skeleton h-44 rounded-2xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
