import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-ink-faint">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="mt-1.5 max-w-md text-sm text-ink-muted">
        That address does not match a page. Asset pages look like{' '}
        <code className="font-mono text-xs">/asset/crypto/BTC</code> or{' '}
        <code className="font-mono text-xs">/asset/equity/AAPL</code>.
      </p>
      <Link
        href="/"
        className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Back to the dashboard
      </Link>
    </div>
  );
}
