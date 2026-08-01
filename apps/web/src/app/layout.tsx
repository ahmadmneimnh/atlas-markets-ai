import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

import { HeaderSearch } from '@/components/search/header-search';

export const metadata: Metadata = {
  title: 'Atlas Markets AI — Global Market Intelligence',
  description:
    'AI-scored Buy / Hold / Sell recommendations for global equities and crypto, with every figure traced to its source.',
};

/**
 * Two destinations, because there are two asset classes.
 *
 * Screener, watchlist, portfolio and the system view all still exist and are
 * still routed — they moved to the footer rather than being deleted. A visitor
 * arriving for the first time is choosing between stocks and crypto, not between
 * five tools they have not seen yet, and a nav bar that lists everything makes
 * that first choice harder rather than easier.
 */
const NAV = [
  { href: '/stocks', label: 'Stocks' },
  { href: '/crypto', label: 'Crypto' },
];

/** Still reachable, just not competing with the primary choice. */
const SECONDARY_NAV = [
  { href: '/screener', label: 'Screener' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/admin', label: 'System' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-50 border-b border-glass-border/60 bg-canvas/70 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-8 px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 2 3 20h4l5-10 5 10h4L12 2Z" fill="url(#atlas-gold)" />
                <defs>
                  <linearGradient id="atlas-gold" x1="3" y1="2" x2="21" y2="20">
                    <stop stopColor="#e8cd7a" />
                    <stop offset="1" stopColor="#a8862a" />
                  </linearGradient>
                </defs>
              </svg>
              <span className="text-[15px] font-semibold tracking-tight">
                Atlas <span className="gold-text">Markets</span>
              </span>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-glass hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Follows the visitor off the landing page, so looking something
                up never requires going back to it — and stays hidden on the
                landing page itself, where it would duplicate the hero field. */}
            <HeaderSearch />
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>

        <footer className="mt-16 border-t border-glass-border/60 py-8">
          <div className="mx-auto max-w-[1400px] px-6 text-xs leading-relaxed text-ink-faint">
            <nav aria-label="Secondary" className="mb-6 flex flex-wrap gap-x-6 gap-y-2">
              {SECONDARY_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-ink-muted transition-colors hover:text-gold"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <p className="mb-2">
              <strong className="text-ink-muted">Not investment advice.</strong> Atlas Markets AI
              produces algorithmic scores from public market data for research purposes only.
            </p>
            <p>
              Every figure displayed is attributed to the provider that supplied it. Where a
              provider is unavailable, the affected factor is excluded from scoring and reported
              rather than estimated.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
