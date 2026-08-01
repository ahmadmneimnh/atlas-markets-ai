import { Suspense } from 'react';
import Link from 'next/link';

import { GlobalSearch } from '@/components/search/global-search';
import { TopOpportunities, TopOpportunitiesSkeleton } from '@/components/home/top-opportunities';

/**
 * The landing page.
 *
 * Deliberately three things: the mark, one search field, two destinations.
 * Everything that used to live here — heatmap, movers, calendars, trending, the
 * scored universe — moved to `/stocks` and `/crypto` behind the cards, so
 * nothing was removed, only relocated behind a decision the visitor makes first.
 *
 * Today's Top Opportunities is streamed inside a Suspense boundary rather than
 * awaited inline. Scoring the universe against live providers takes seconds; the
 * search field needs nothing at all. Awaiting the scan before painting would
 * block the one control this page exists for behind the slowest thing it does.
 */
export const metadata = {
  title: 'Atlas Markets AI — Search any stock or cryptocurrency',
};

const CARDS = [
  {
    href: '/stocks',
    icon: '📈',
    title: 'Stock Market',
    blurb: 'NYSE, NASDAQ, London, Frankfurt, Hong Kong, Tokyo, Sydney, Toronto',
  },
  {
    href: '/crypto',
    icon: '₿',
    title: 'Cryptocurrency',
    blurb: 'Bitcoin, Ethereum, Solana, XRP, BNB and the major digital assets',
  },
] as const;

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl py-12">
      <div className="mx-auto max-w-3xl animate-fade-up text-center">
        <div className="mb-6 flex justify-center">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 2 3 20h4l5-10 5 10h4L12 2Z" fill="url(#atlas-hero)" />
            <defs>
              <linearGradient id="atlas-hero" x1="3" y1="2" x2="21" y2="20">
                <stop stopColor="#e8cd7a" />
                <stop offset="1" stopColor="#a8862a" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Atlas <span className="gold-text">Markets AI</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-balance text-sm leading-relaxed text-ink-muted">
          AI-scored Buy / Hold / Sell recommendations for global equities and cryptocurrency — with
          every figure traced to the provider that supplied it.
        </p>
      </div>

      <div className="mx-auto mt-10 max-w-3xl animate-fade-up">
        {/* autoFocus is right here and nowhere else: this page exists to be
            typed into, so the caret belongs in the field. On a page with other
            content it would steal focus from a screen reader's landmark. */}
        <GlobalSearch autoFocus />
        <p className="mt-3 text-center text-xs text-ink-faint">
          Try <SearchHint>AAPL</SearchHint> <SearchHint>Apple</SearchHint>{' '}
          <SearchHint>TSLA</SearchHint> <SearchHint>Tesla</SearchHint> <SearchHint>BTC</SearchHint>{' '}
          <SearchHint>Bitcoin</SearchHint> <SearchHint>ETH</SearchHint>{' '}
          <SearchHint>Ethereum</SearchHint>
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-3xl animate-fade-up gap-5 sm:grid-cols-2">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="glass glass-hover group flex flex-col items-start rounded-3xl p-8 focus-visible:ring-2 focus-visible:ring-gold/60"
          >
            <span
              className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-glass-border bg-glass-strong text-2xl transition-transform duration-300 group-hover:scale-110"
              aria-hidden
            >
              {card.icon}
            </span>
            <span className="text-xl font-semibold tracking-tight text-ink">{card.title}</span>
            <span className="mt-2 text-sm leading-relaxed text-ink-muted">{card.blurb}</span>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm text-gold transition-transform duration-300 group-hover:translate-x-1">
              Open
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden
              >
                <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </Link>
        ))}
      </div>

      <section className="mt-16">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-semibold tracking-tight">
            Today&apos;s <span className="gold-text">Top Opportunities</span>
          </h2>
          <p className="mt-1.5 text-xs text-ink-muted">
            Ranked by AI score from live provider data — never estimated, never filled in
          </p>
        </div>

        <Suspense fallback={<TopOpportunitiesSkeleton />}>
          <TopOpportunities />
        </Suspense>
      </section>
    </div>
  );
}

function SearchHint({ children }: { children: React.ReactNode }) {
  return (
    <code className="mx-0.5 rounded-md border border-glass-border bg-glass px-1.5 py-0.5 text-[11px] text-ink-muted">
      {children}
    </code>
  );
}
