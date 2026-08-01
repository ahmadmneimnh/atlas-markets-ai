import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetHttpState } from '@/lib/http';
import { __clearCache } from '@/lib/cache';

/**
 * Routing tests for the provider registry.
 *
 * These exist because the failure they guard against is silent: sending a stock
 * symbol to a crypto vendor produces an authoritative-looking "this symbol does not
 * exist", which the registry treats as a final answer and stops searching — so a
 * correctly configured stock chart would render as "Insufficient Data" forever.
 */

const originalFetch = globalThis.fetch;

/** Records every URL requested and answers each with the supplied payload. */
function recordFetch(payload: unknown, status = 200) {
  const urls: string[] = [];
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    urls.push(String(url));
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });
  }) as unknown as typeof fetch;
  return urls;
}

const hosts = (urls: string[]) => urls.map((u) => new URL(u).host);

beforeEach(() => {
  __resetHttpState();
  __clearCache();
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe('capability routing', () => {
  it('sends stock price history to the equity provider only', async () => {
    vi.stubEnv('ALPHA_VANTAGE_API_KEY', 'test-key');
    const urls = recordFetch({
      'Time Series (Daily)': {
        '2026-07-31': { '1. open': '100', '2. high': '101', '3. low': '99', '4. close': '100.5', '5. volume': '1000' },
      },
    });

    const { market } = await import('@/lib/providers/registry');
    const r = await market.ohlcv('AAPL', 'equity', '1d', 30);

    expect(r.ok).toBe(true);
    expect(hosts(urls)).toEqual(['www.alphavantage.co']);
    expect(hosts(urls)).not.toContain('api.binance.com');
  });

  it('sends crypto price history to the crypto providers only', async () => {
    vi.stubEnv('ALPHA_VANTAGE_API_KEY', 'test-key');
    const urls = recordFetch([[1735603200000, '94000', '95000', '93500', '94800', '12.5', 1735689599999]]);

    const { market } = await import('@/lib/providers/registry');
    const r = await market.ohlcv('BTC', 'crypto', '1d', 30);

    expect(r.ok).toBe(true);
    expect(hosts(urls)).toEqual(['api.binance.com']);
    expect(hosts(urls)).not.toContain('www.alphavantage.co');
  });

  it('reports "no provider configured" for stock charts when no equity key is set', async () => {
    const urls = recordFetch({});

    const { market } = await import('@/lib/providers/registry');
    const r = await market.ohlcv('AAPL', 'equity', '1d', 30);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_provider_configured');
    // Nothing was requested: an unconfigured capability must not spend a request
    // discovering that it is unconfigured.
    expect(urls).toEqual([]);
  });

  it('serves crypto quotes with no credentials at all', async () => {
    const urls = recordFetch([
      {
        id: 'bitcoin', symbol: 'btc', name: 'Bitcoin',
        current_price: 94812.37, price_change_24h: 2231.4, price_change_percentage_24h: 2.41,
        high_24h: 96000, low_24h: 92000, total_volume: 4.2e10, market_cap: 1.9e12,
        circulating_supply: 19.8e6, total_supply: 21e6, max_supply: 21e6,
        market_cap_rank: 1, last_updated: '2026-08-01T12:00:00.000Z',
      },
    ]);

    const { market } = await import('@/lib/providers/registry');
    const r = await market.quote('BTC', 'crypto');

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.price).toBe(94812.37);
    expect(r.data.source).toBe('coingecko');
    expect(hosts(urls)).toContain('api.coingecko.com');
  });

  it('never routes an equity quote to a crypto vendor', async () => {
    const urls = recordFetch({});

    const { market } = await import('@/lib/providers/registry');
    const r = await market.quote('AAPL', 'equity');

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_provider_configured');
    expect(urls).toEqual([]);
  });

  it('respects the priority override env var', async () => {
    vi.stubEnv('BB_PRIORITY_CRYPTO_OHLCV', 'coingecko');
    const urls = recordFetch([[1735603200000, 94000, 95000, 93500, 94800]]);

    const { market } = await import('@/lib/providers/registry');
    const r = await market.ohlcv('BTC', 'crypto', '1d', 30);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.source).toBe('coingecko');
    expect(hosts(urls)[0]).toBe('api.coingecko.com');
  });
});

describe('provider status', () => {
  it('reports configuration without exposing key values', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'super-secret');
    const { providerStatus } = await import('@/lib/providers/registry');

    const status = providerStatus();
    const finnhub = status.find((p) => p.id === 'finnhub');
    expect(finnhub?.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain('super-secret');

    // Both crypto vendors are usable without any credential at all.
    expect(status.find((p) => p.id === 'coingecko')?.configured).toBe(true);
    expect(status.find((p) => p.id === 'binance')?.configured).toBe(true);
  });

  it('treats a placeholder key as absent', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'your-key-here');
    const { coverage } = await import('@/lib/env');
    expect(coverage().stocks).toBe(false);
  });
});
