import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { ThemeToggle, themeInitScript } from '@/components/theme-toggle';
import { SearchBox } from '@/components/search-box';

export const metadata: Metadata = {
  title: "Batal's Brain — Live Market Dashboard",
  description:
    'Live cryptocurrency and stock prices, search and interactive charts, sourced from CoinGecko, Binance, Finnhub and Alpha Vantage.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sets the theme class before first paint; see components/theme-toggle.tsx. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-4 px-4 sm:px-6">
            <Link href="/" className="flex shrink-0 items-center gap-2">
              <Logo />
              <span className="text-[15px] font-semibold tracking-tight text-ink">
                Batal&apos;s <span className="text-accent">Brain</span>
              </span>
            </Link>

            <nav className="hidden items-center gap-1 sm:flex">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/scanner">Scanner</NavLink>
            </nav>

            <SearchBox className="ml-auto w-full max-w-xs sm:max-w-sm" />
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>

        <footer className="mt-12 border-t border-line py-8">
          <div className="mx-auto max-w-[1200px] space-y-2 px-4 text-xs leading-relaxed text-ink-faint sm:px-6">
            {/* The header nav is hidden on narrow screens, so these are how a phone
                reaches the scanner. */}
            <nav className="flex gap-4 pb-2 sm:hidden">
              <Link href="/" className="text-ink-muted hover:text-ink">Dashboard</Link>
              <Link href="/scanner" className="text-ink-muted hover:text-ink">Scanner</Link>
            </nav>
            <p>
              <strong className="text-ink-muted">Batal&apos;s Brain</strong> — market data for
              research and information only. Not investment advice.
            </p>
            <p>
              Prices come from CoinGecko, Binance, Finnhub and Alpha Vantage, and each figure is
              labelled with the source that supplied it. Where a source is unavailable the app shows{' '}
              <span className="text-ink-muted">Insufficient Data</span> rather than an estimate.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
    >
      {children}
    </Link>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="6" className="fill-accent" />
      <path
        d="M6.5 15.5 10 11l3 3 4.5-6"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
