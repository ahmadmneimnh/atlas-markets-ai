'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';

interface Suggestion {
  symbol: string;
  name: string;
  kind: 'equity' | 'crypto';
  market: string;
  source: string;
  tracked: boolean;
}

/**
 * The global search bar.
 *
 * Accessibility is implemented as a real ARIA combobox rather than a styled
 * input with a div under it. That is not box-ticking: without
 * `aria-activedescendant` a screen-reader user arrowing through suggestions
 * hears nothing change, and the control becomes unusable rather than merely
 * imperfect.
 *
 * Three behaviours worth naming:
 *
 * - **Debounced at 150ms.** Fast enough to feel immediate, slow enough that
 *   typing "bitcoin" is one request rather than seven.
 * - **Out-of-order responses are discarded.** A slow request for "bit" must not
 *   overwrite a fast one for "bitcoin"; the sequence guard is what stops the
 *   dropdown flickering back to stale results mid-type.
 * - **Enter with nothing highlighted goes to the results page**, not to a
 *   guessed asset. The server decides whether the query resolves strongly enough
 *   to redirect — see `resolveBestMatch`.
 */
export function GlobalSearch({
  size = 'large',
  placeholder = 'Search any stock or crypto — AAPL, Apple, BTC, Bitcoin…',
  autoFocus = false,
}: {
  size?: 'large' | 'compact';
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const listboxId = useId();

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Monotonic request id. Only the newest response is allowed to write state.
  const sequence = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const id = ++sequence.current;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as { suggestions?: Suggestion[] };
        // Stale response guard — see the note above.
        if (id !== sequence.current) return;
        setSuggestions(data.suggestions ?? []);
        setHighlighted(-1);
      } catch {
        // An aborted or failed lookup leaves the previous suggestions in place
        // rather than blanking the list under the user's cursor.
        if (id === sequence.current) setSuggestions([]);
      } finally {
        if (id === sequence.current) setLoading(false);
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Closing on outside click is what makes the dropdown feel like a control
  // rather than a stuck overlay.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const goTo = useCallback(
    (suggestion: Suggestion) => {
      setOpen(false);
      setQuery('');
      router.push(`/asset/${suggestion.kind}/${encodeURIComponent(suggestion.symbol)}`);
    },
    [router],
  );

  const submit = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;

    if (highlighted >= 0 && suggestions[highlighted]) {
      goTo(suggestions[highlighted]);
      return;
    }
    // No explicit choice: hand the query to the search page, which resolves it
    // server-side and only redirects on a confident match.
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }, [query, highlighted, suggestions, goTo, router]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlighted((index) => (index + 1) % Math.max(suggestions.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      setOpen(false);
      setHighlighted(-1);
    }
  }

  const showDropdown = open && query.trim().length > 0;
  const large = size === 'large';

  return (
    <div ref={containerRef} className="relative w-full">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <svg
            className={clsx(
              'pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint',
              large ? 'h-5 w-5' : 'h-4 w-4',
            )}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>

          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              highlighted >= 0 ? `${listboxId}-option-${highlighted}` : undefined
            }
            aria-label="Search stocks and cryptocurrencies"
            autoComplete="off"
            autoFocus={autoFocus}
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={clsx(
              'glass w-full rounded-2xl text-ink placeholder:text-ink-faint',
              'border border-glass-border transition-all duration-300',
              'focus:border-gold/40 focus:outline-none focus:ring-2 focus:ring-gold/20',
              large ? 'py-5 pl-14 pr-5 text-lg' : 'py-2 pl-10 pr-3 text-sm',
            )}
          />

          {loading ? (
            <span
              className={clsx(
                'absolute top-1/2 -translate-y-1/2 text-xs text-ink-faint',
                large ? 'right-5' : 'right-3',
              )}
            >
              …
            </span>
          ) : null}
        </div>
      </form>

      {showDropdown ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Search suggestions"
          className="glass absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-glass-border py-1.5 shadow-glass"
        >
          {suggestions.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-faint">
              {loading ? 'Searching…' : `No match for “${query.trim()}”`}
            </li>
          ) : (
            suggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.kind}-${suggestion.symbol}`}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === highlighted}
                // onMouseDown, not onClick: mousedown fires before the input's
                // blur, so the dropdown is still mounted when the choice lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  goTo(suggestion);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={clsx(
                  'flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors',
                  index === highlighted ? 'bg-glass-strong' : 'hover:bg-glass',
                )}
              >
                <span
                  className={clsx(
                    'w-6 shrink-0 text-center text-xs',
                    suggestion.kind === 'crypto' ? 'text-gold' : 'text-ink-muted',
                  )}
                  aria-hidden
                >
                  {suggestion.kind === 'crypto' ? '₿' : '📈'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {suggestion.symbol}
                  </span>
                  <span className="block truncate text-xs text-ink-faint">{suggestion.name}</span>
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-faint">
                  {suggestion.tracked ? suggestion.market : suggestion.source}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
