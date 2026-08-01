import Link from 'next/link';
import { isDatabaseConfigured, prisma } from '@atlas/db';

import { currentUser, isAuthConfigured } from '@/lib/auth';
import { market } from '@/lib/providers/registry';
import { summarise, type HoldingInput } from '@/lib/portfolio/analytics';
import { SectionTitle, Unavailable } from '@/components/primitives';
import { PortfolioSummaryPanel } from '@/components/portfolio/summary';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Portfolio · Atlas Markets AI' };

export default async function PortfolioPage() {
  // Three separate preconditions with three different remedies, so they are
  // reported separately rather than collapsed into one "unavailable".
  if (!isDatabaseConfigured) {
    return (
      <Shell>
        <Unavailable
          title="No database configured"
          reason="Portfolios are stored server-side and this deployment has no DATABASE_URL."
          hint="Run `npm run infra:up` then `npm run db:push`."
        />
      </Shell>
    );
  }

  if (!isAuthConfigured) {
    return (
      <Shell>
        <Unavailable
          title="Sign-in is not configured"
          reason="A portfolio belongs to an account, and no authentication provider is set up."
          hint="See docs/AUTHENTICATION.md."
        />
      </Shell>
    );
  }

  const user = await currentUser();
  if (!user) {
    return (
      <Shell>
        <Unavailable title="Sign in to view your portfolio" reason="" />
        <Link
          href="/signin?callbackUrl=/portfolio"
          className="mt-4 inline-block text-sm text-gold hover:underline"
        >
          Sign in →
        </Link>
      </Shell>
    );
  }

  const portfolios = await prisma.portfolio.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
    include: {
      positions: {
        include: {
          asset: { select: { symbol: true, kind: true, name: true, equityProfile: true } },
          lots: { where: { soldAt: null }, orderBy: { purchasedAt: 'asc' } },
        },
      },
    },
  });

  if (portfolios.length === 0) {
    return (
      <Shell>
        <Unavailable
          title="No portfolio yet"
          reason="Create one and record a BUY transaction to see valuation, allocation, diversification and risk."
          hint="POST /api/portfolios, then POST /api/portfolios/{id}/transactions."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {await Promise.all(
        portfolios.map(async (portfolio) => {
          // Prices are fetched per distinct asset, not per lot. A position with
          // twelve lots is one quote, and the cache layer de-duplicates across
          // portfolios for the same viewer.
          const holdings: HoldingInput[] = await Promise.all(
            portfolio.positions.map(async (position) => {
              const kind = position.asset.kind === 'CRYPTO' ? 'crypto' : 'equity';
              const quote = await market.quote(position.asset.symbol, kind);

              const holding: HoldingInput = {
                symbol: position.asset.symbol,
                kind,
                lots: position.lots.map((lot) => ({
                  quantity: Number(lot.quantity),
                  pricePaid: Number(lot.pricePaid),
                  fees: Number(lot.fees),
                  purchasedAt: lot.purchasedAt,
                })),
              };
              if (quote.ok) holding.price = quote.data.price;
              const sector = position.asset.equityProfile?.sector;
              if (sector) holding.sector = sector;
              return holding;
            }),
          );

          const summary = summarise(holdings);

          return (
            <section key={portfolio.id} className="space-y-5">
              <SectionTitle
                hint={`${portfolio.baseCurrency} · ${summary.holdings.length} priced positions`}
              >
                {portfolio.name}
              </SectionTitle>
              <PortfolioSummaryPanel summary={summary} currency={portfolio.baseCurrency} />
            </section>
          );
        }),
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-8 animate-fade-up">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Portfolio</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Lot-level cost basis, live valuation, and concentration and risk measured on what could
          actually be priced.
        </p>
      </div>
      {children}
    </div>
  );
}
