/**
 * Number and date formatting shared by server and client components.
 *
 * No function here invents a value: given `undefined` they return a dash, and the
 * caller decides whether a dash or a full "Insufficient Data" panel is the right
 * way to say "we do not have this".
 */

/**
 * Prices need different precision at different magnitudes: $0.00001234 for a
 * micro-cap token and $185.42 for a large-cap stock. A fixed two decimals renders
 * the former as $0.00.
 */
export function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(4);
  return n.toPrecision(4);
}

export function formatCurrency(n: number, currency = 'USD'): string {
  const symbol = currency === 'USD' || currency === 'USDT' ? '$' : '';
  return `${symbol}${formatPrice(n)}`;
}

/** Large values compactly, without losing meaningful precision. */
export function formatCompact(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

export function formatPercent(n: number | undefined, digits = 2): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

export function formatNumber(n: number | undefined, digits = 2): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/**
 * Relative time. Only ever called from client components after mount: rendering it
 * on the server would produce "3s ago" in the HTML and a different value at
 * hydration, which React reports as a mismatch.
 */
export function formatRelative(iso: string | Date, now = Date.now()): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const seconds = Math.floor((now - date.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const DATE_SHORT_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export function formatDate(t: number | Date): string {
  return DATE_FMT.format(typeof t === 'number' ? new Date(t) : t);
}

export function formatDateShort(t: number | Date): string {
  return DATE_SHORT_FMT.format(typeof t === 'number' ? new Date(t) : t);
}
