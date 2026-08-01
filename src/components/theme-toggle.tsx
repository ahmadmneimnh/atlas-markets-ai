'use client';

import { useEffect, useState } from 'react';

export const THEME_KEY = 'bb-theme';

/**
 * The script that runs before first paint.
 *
 * Theme has to be applied before the browser paints, otherwise a dark-mode user
 * sees a white flash on every navigation. React cannot do this — its first render
 * happens after paint — so the class is set by this snippet in <head>, and the
 * toggle below only ever reads back what it finds there.
 */
export const themeInitScript = `(function(){try{
  var stored = localStorage.getItem('${THEME_KEY}');
  var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}catch(e){}})();`;

type Theme = 'light' | 'dark';

function apply(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private browsing modes can refuse localStorage; the toggle still works for
    // this page view, it just will not be remembered.
  }
}

export function ThemeToggle() {
  // Null until mounted: the server does not know which theme the browser chose, so
  // rendering an icon during SSR would guarantee a hydration mismatch.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => {
        apply(next);
        setTheme(next);
      }}
      aria-label={theme ? `Switch to ${next} mode` : 'Switch colour theme'}
      title={theme ? `Switch to ${next} mode` : 'Switch colour theme'}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted transition-colors hover:text-ink"
    >
      {theme === null ? (
        <span className="h-4 w-4" />
      ) : theme === 'dark' ? (
        <SunIcon />
      ) : (
        <MoonIcon />
      )}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
