'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import type { AssetKind } from '@/lib/providers/types';

interface Hit {
  symbol: string;
  name: string;
  kind: AssetKind;
  source: string;
}

/**
 * Header search with type-ahead over both asset classes.
 *
 * Every keystroke is a provider request on a metered free tier, so input is
 * debounced and in-flight requests are aborted when superseded — otherwise a fast
 * typist burns a minute of Finnhub quota on prefixes they never meant to search.
 */
export function SearchBox({ className }: { className?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const body = (await res.json()) as { results?: Hit[] };
        setHits(body.results ?? []);
        setActive(-1);
      } catch {
        // Aborted or offline. Leaving the previous list up would be worse than
        // showing nothing, because it would look like a result for the new query.
        if (!controller.signal.aborted) setHits([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 280);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  function go(hit: Hit) {
    setOpen(false);
    setQuery('');
    router.push(`/asset/${hit.kind}/${encodeURIComponent(hit.symbol)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const list = hits ?? [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = list[active];
      if (chosen) go(chosen);
      else if (query.trim()) {
        setOpen(false);
        router.push(`/search?q=${encodeURIComponent(query.trim())}`);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className={clsx('relative', className)}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search stocks and crypto…"
          aria-label="Search stocks and crypto"
          autoComplete="off"
          className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent/50"
        />
      </div>

      {open && query.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-lg border border-line bg-surface-raised shadow-lift">
          {loading && hits === null ? (
            <p className="px-3 py-3 text-xs text-ink-faint">Searching…</p>
          ) : hits && hits.length > 0 ? (
            <ul role="listbox">
              {hits.slice(0, 12).map((hit, i) => (
                <li key={`${hit.kind}-${hit.symbol}-${i}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(hit)}
                    className={clsx(
                      'flex w-full items-center gap-3 px-3 py-2 text-left',
                      i === active ? 'bg-accent-soft' : 'hover:bg-canvas',
                    )}
                  >
                    <span className="w-16 shrink-0 truncate text-xs font-semibold text-ink">{hit.symbol}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{hit.name}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-faint">
                      {hit.kind === 'crypto' ? 'Crypto' : 'Stock'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-xs text-ink-faint">
              No matches. Press Enter to run a full search.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
