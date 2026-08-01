'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Live<T> {
  data: T;
  /** When the data currently on screen was received. Null until the first poll. */
  updatedAt: number | null;
  refreshing: boolean;
  /** Set when the last attempt failed; the previous data stays on screen. */
  error: string | null;
  refresh: () => void;
}

/**
 * Polls a JSON endpoint on an interval, seeded with server-rendered data.
 *
 * Polling stops while the tab is hidden and resumes with an immediate fetch when it
 * becomes visible again. A dashboard left open in a background tab would otherwise
 * spend the whole free-tier quota on a screen nobody is looking at, and would show
 * a stale price for one interval after the user came back.
 */
export function useLive<T>(url: string, intervalMs: number, initial: T): Live<T> {
  const [data, setData] = useState<T>(initial);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so the effect below does not restart on every fetch.
  const inFlight = useRef<AbortController | null>(null);

  const fetchNow = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setRefreshing(true);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const body = (await res.json()) as T;
      setData(body);
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      if (controller.signal.aborted) return;
      // Keep the last good data on screen and say so, rather than blanking the
      // dashboard because one poll failed.
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, [url]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => void fetchNow(), intervalMs);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void fetchNow();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      inFlight.current?.abort();
    };
  }, [fetchNow, intervalMs]);

  return { data, updatedAt, refreshing, error, refresh: () => void fetchNow() };
}

/** Re-renders once a second so "12s ago" labels actually count up. */
export function useTicker(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
