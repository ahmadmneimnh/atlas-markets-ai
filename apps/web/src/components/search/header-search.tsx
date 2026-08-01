'use client';

import { usePathname } from 'next/navigation';

import { GlobalSearch } from './global-search';

/**
 * The compact search in the header, hidden on the landing page.
 *
 * The landing page's entire purpose is one large search field. A second, smaller
 * one in the header above it is visual noise and a genuine accessibility
 * problem: two comboboxes with the same label make "search" ambiguous to a
 * screen reader listing the page's controls.
 *
 * A client component only because `usePathname` requires one. It renders nothing
 * on `/`, so the landing page ships no extra markup for it.
 */
export function HeaderSearch() {
  const pathname = usePathname();
  if (pathname === '/') return null;

  return (
    <div className="ml-auto hidden w-72 sm:block">
      <GlobalSearch size="compact" placeholder="Search ticker, company, coin…" />
    </div>
  );
}
