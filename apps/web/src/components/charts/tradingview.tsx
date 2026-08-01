'use client';

import { useEffect, useRef, useState } from 'react';

import type { AssetKind, Market } from '@/lib/providers/types';

/**
 * TradingView advanced chart widget.
 *
 * This is the one place in Atlas where numbers on screen do not come from our
 * provider layer — the widget fetches its own data from TradingView. That is a
 * deliberate exception and it is **labelled on screen**, because an unlabelled
 * chart beside our quotes implies a single source of truth that does not exist:
 * TradingView's close and Finnhub's close will differ, and a user comparing them
 * deserves to know why.
 *
 * The script is injected rather than imported: it is third-party, and loading it
 * only when a chart is actually rendered keeps it off every other page's critical
 * path. If it fails to load — offline, blocked by an extension, CSP — the
 * component says so rather than leaving an empty frame that reads as "this asset
 * has no price history".
 */

/** TradingView's exchange prefixes. A wrong prefix silently charts a different instrument. */
const MARKET_PREFIX: Partial<Record<Market, string>> = {
  NYSE: 'NYSE',
  NASDAQ: 'NASDAQ',
  AMEX: 'AMEX',
  LSE: 'LSE',
  FRA: 'FWB',
  XETRA: 'XETR',
  EURONEXT: 'EURONEXT',
  SIX: 'SIX',
  HKEX: 'HKEX',
  TSE: 'TSE',
  ASX: 'ASX',
  TSX: 'TSX',
  TSXV: 'TSXV',
  BVMF: 'BMFBOVESPA',
  JSE: 'JSE',
  NSE: 'NSE',
  BSE: 'BSE',
};

export function tradingViewSymbol(symbol: string, market: Market, kind: AssetKind): string | null {
  if (kind === 'crypto') return `BINANCE:${symbol.toUpperCase()}USDT`;
  const prefix = MARKET_PREFIX[market];
  // No mapping → no chart. Guessing a prefix would render a confident chart of
  // some other company's price, which is worse than rendering nothing.
  return prefix ? `${prefix}:${symbol.toUpperCase()}` : null;
}

export function TradingViewChart({
  symbol,
  market,
  kind,
  height = 420,
}: {
  symbol: string;
  market: Market;
  kind: AssetKind;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  const tvSymbol = tradingViewSymbol(symbol, market, kind);

  useEffect(() => {
    const node = container.current;
    if (!node || !tvSymbol) return;

    node.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.type = 'text/javascript';
    script.innerHTML = JSON.stringify({
      symbol: tvSymbol,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(5, 6, 10, 1)',
      gridColor: 'rgba(255, 255, 255, 0.06)',
      hide_side_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      autosize: true,
      studies: ['STD;RSI', 'STD;MACD'],
    });

    script.addEventListener('load', () => setStatus('ready'));
    script.addEventListener('error', () => setStatus('failed'));
    node.appendChild(script);

    // Clearing on unmount matters here: the widget attaches listeners and a
    // resize observer to the document, and a route change without cleanup leaks
    // one per visited asset.
    return () => {
      node.innerHTML = '';
    };
  }, [tvSymbol]);

  if (!tvSymbol) {
    return (
      <div className="rounded-xl border border-dashed border-glass-border/70 px-6 py-10 text-center text-sm text-ink-muted">
        No TradingView symbol is mapped for {market}. The chart is omitted rather than guessed — a
        wrong exchange prefix charts a different instrument.
      </div>
    );
  }

  return (
    <div>
      <div
        ref={container}
        style={{ height }}
        className="overflow-hidden rounded-xl border border-glass-border"
      />
      <p className="mt-2 text-xs text-ink-faint">
        Chart data: TradingView ({tvSymbol}) — an independent source from the quotes and scores
        above, so closes may differ slightly.
        {status === 'failed' ? ' The widget failed to load.' : ''}
      </p>
    </div>
  );
}
