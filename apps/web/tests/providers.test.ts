import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetHttpState } from '@/lib/http';
import { __clearCache } from '@/lib/cache';

/**
 * Adapter tests against recorded response *shapes* from each vendor.
 *
 * The transport is mocked, so these do not verify that the live endpoints are up —
 * they verify the thing that actually breaks in production: normalization, and the
 * per-vendor quirks that must be absorbed at the adapter boundary rather than
 * leaking into the domain.
 */

const originalFetch = globalThis.fetch;

function mockFetch(payload: unknown, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  __resetHttpState();
  __clearCache();
  vi.stubEnv('FINNHUB_API_KEY', 'test-key');
  vi.stubEnv('ALPHA_VANTAGE_API_KEY', 'test-key');
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe('finnhub adapter', () => {
  it('normalizes the c/d/dp/h/l/o/pc quote shorthand', async () => {
    mockFetch({
      c: 185.42,
      d: 2.13,
      dp: 1.16,
      h: 186.1,
      l: 183.5,
      o: 184,
      pc: 183.29,
      t: 1735689600,
    });
    const { finnhub } = await import('@/lib/providers/equity/finnhub');

    const r = await finnhub.quote!('AAPL');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.price).toBe(185.42);
    expect(r.data.changePercent).toBe(1.16);
    expect(r.data.previousClose).toBe(183.29);
    // Provenance is mandatory — a value with no source must not reach the domain.
    expect(r.data.source).toBe('finnhub');
    expect(r.data.asOf).toBeInstanceOf(Date);
  });

  it('treats the all-zero payload for an unknown symbol as not_found, not a $0 quote', async () => {
    // Finnhub answers 200 with zeros rather than 404. Parsed naively this puts
    // "$0.00" on screen as if it were a real price.
    mockFetch({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 });
    const { finnhub } = await import('@/lib/providers/equity/finnhub');

    const r = await finnhub.quote!('NOTAREALTICKER');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_found');
  });

  it('parses metrics that arrive as numeric strings', async () => {
    mockFetch({ metric: { peTTM: '28.4', roeTTM: 147.2, revenueGrowthTTMYoy: '8.1' } });
    const { finnhub } = await import('@/lib/providers/equity/finnhub');

    const r = await finnhub.fundamentals!('AAPL');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.peRatio).toBe(28.4);
    expect(r.data.roe).toBe(147.2);
    expect(r.data.revenueGrowthYoY).toBe(8.1);
  });

  it('omits fields the provider did not return rather than defaulting them', async () => {
    mockFetch({ metric: { peTTM: 28.4 } });
    const { finnhub } = await import('@/lib/providers/equity/finnhub');

    const r = await finnhub.fundamentals!('AAPL');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.peRatio).toBe(28.4);
    // Absent, not zero. A zero P/E would score as "extremely cheap".
    expect(r.data.pegRatio).toBeUndefined();
    expect(r.data.roe).toBeUndefined();
    expect('pegRatio' in r.data).toBe(false);
  });

  it('reports not configured when the key is absent', async () => {
    vi.stubEnv('FINNHUB_API_KEY', '');
    vi.resetModules();
    const { finnhub } = await import('@/lib/providers/equity/finnhub');
    expect(finnhub.isConfigured()).toBe(false);
  });

  it('treats placeholder keys as absent', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'your-key-here');
    vi.resetModules();
    const { finnhub } = await import('@/lib/providers/equity/finnhub');
    expect(finnhub.isConfigured()).toBe(false);
  });
});

describe('alpha vantage adapter', () => {
  it('detects quota exhaustion delivered as HTTP 200 with a Note field', async () => {
    // The critical quirk: 200 OK, but the body is a rate-limit message. Parsed
    // naively this becomes an empty series that reads as "no price history".
    mockFetch({
      Note: 'Thank you for using Alpha Vantage! Our standard API call frequency is 25 requests per day.',
    });
    const { alphavantage } = await import('@/lib/providers/equity/alphavantage');

    const r = await alphavantage.ohlcv!('AAPL', '1d', 100);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('rate_limited');
  });

  it('detects the Information variant of the quota message', async () => {
    mockFetch({ Information: 'You have reached the premium endpoint limit.' });
    const { alphavantage } = await import('@/lib/providers/equity/alphavantage');

    const r = await alphavantage.ohlcv!('AAPL', '1d', 100);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('rate_limited');
  });

  it('parses string-typed OHLC values and sorts oldest-first', async () => {
    mockFetch({
      'Time Series (Daily)': {
        // Deliberately newest-first, as the API returns it.
        '2025-01-03': {
          '1. open': '184.0',
          '2. high': '186.1',
          '3. low': '183.5',
          '4. close': '185.4',
          '5. volume': '48000000',
        },
        '2025-01-02': {
          '1. open': '182.0',
          '2. high': '184.0',
          '3. low': '181.0',
          '4. close': '183.3',
          '5. volume': '52000000',
        },
      },
    });
    const { alphavantage } = await import('@/lib/providers/equity/alphavantage');

    const r = await alphavantage.ohlcv!('AAPL', '1d', 100);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.candles).toHaveLength(2);
    // Indicators assume oldest → newest; a reversed series silently inverts every
    // trend signal.
    expect(r.data.candles[0]!.time.getTime()).toBeLessThan(r.data.candles[1]!.time.getTime());
    expect(r.data.candles[1]!.close).toBe(185.4);
    expect(r.data.candles[0]!.volume).toBe(52000000);
  });

  it('skips malformed bars instead of emitting NaN candles', async () => {
    mockFetch({
      'Time Series (Daily)': {
        '2025-01-02': {
          '1. open': '182.0',
          '2. high': '184.0',
          '3. low': '181.0',
          '4. close': '183.3',
          '5. volume': '52000000',
        },
        '2025-01-03': {
          '1. open': 'None',
          '2. high': '-',
          '3. low': '',
          '4. close': '',
          '5. volume': '',
        },
      },
    });
    const { alphavantage } = await import('@/lib/providers/equity/alphavantage');

    const r = await alphavantage.ohlcv!('AAPL', '1d', 100);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.candles).toHaveLength(1);
    for (const c of r.data.candles) {
      expect(Number.isFinite(c.close)).toBe(true);
      expect(Number.isFinite(c.open)).toBe(true);
    }
  });
});

describe('binance adapter', () => {
  it('parses the all-strings ticker payload', async () => {
    mockFetch({
      symbol: 'BTCUSDT',
      lastPrice: '95432.10',
      priceChange: '1234.50',
      priceChangePercent: '1.31',
      highPrice: '96000.00',
      lowPrice: '94000.00',
      openPrice: '94197.60',
      prevClosePrice: '94197.60',
      volume: '12345.678',
      closeTime: 1735689600000,
    });
    const { binance } = await import('@/lib/providers/crypto/binance');

    const r = await binance.cryptoQuote!('BTC');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.price).toBeCloseTo(95432.1, 2);
    expect(r.data.changePercent).toBeCloseTo(1.31, 2);
    expect(r.data.volume).toBeCloseTo(12345.678, 3);
    expect(r.data.source).toBe('binance');
  });

  it('parses klines into candles with real volume', async () => {
    mockFetch([
      [1735603200000, '94000.0', '95000.0', '93500.0', '94800.0', '1200.5', 1735689599999],
      [1735689600000, '94800.0', '96000.0', '94500.0', '95432.1', '1450.2', 1735775999999],
    ]);
    const { binance } = await import('@/lib/providers/crypto/binance');

    const r = await binance.ohlcv!('BTC', '1d', 100);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.candles).toHaveLength(2);
    expect(r.data.candles[1]!.close).toBeCloseTo(95432.1, 2);
    // Volume is why Binance is preferred over CoinGecko for OHLCV.
    expect(r.data.candles[1]!.volume).toBeCloseTo(1450.2, 2);
  });
});

describe('coingecko adapter', () => {
  it('normalizes a market row', async () => {
    mockFetch([
      {
        id: 'bitcoin',
        symbol: 'btc',
        name: 'Bitcoin',
        current_price: 95432.1,
        price_change_24h: 1234.5,
        price_change_percentage_24h: 1.31,
        high_24h: 96000,
        low_24h: 94000,
        total_volume: 45000000000,
        market_cap: 1890000000000,
        circulating_supply: 19800000,
        total_supply: 21000000,
        max_supply: 21000000,
        market_cap_rank: 1,
        last_updated: '2025-01-01T00:00:00.000Z',
      },
    ]);
    const { coingecko } = await import('@/lib/providers/crypto/coingecko');

    const r = await coingecko.cryptoQuote!('BTC');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.price).toBe(95432.1);
    expect(r.data.symbol).toBe('BTC');
    expect(r.data.source).toBe('coingecko');
  });

  it('marks OHLC candles as zero-volume so volume indicators are skipped', async () => {
    // CoinGecko's /ohlc carries no volume. The adapter must not invent one — the
    // indicators detect the zero and decline to compute VWAP.
    mockFetch([
      [1735603200000, 94000, 95000, 93500, 94800],
      [1735689600000, 94800, 96000, 94500, 95432],
    ]);
    const { coingecko } = await import('@/lib/providers/crypto/coingecko');

    const r = await coingecko.ohlcv!('BTC', '1d', 100);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.candles.every((c) => c.volume === 0)).toBe(true);

    const { vwap, volumeRatio } = await import('@/lib/analysis/indicators');
    expect(vwap(r.data.candles)).toBeUndefined();
    expect(volumeRatio(r.data.candles, 1)).toBeUndefined();
  });

  it('extracts developer activity from the coin detail document', async () => {
    mockFetch({
      id: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      market_cap_rank: 1,
      developer_data: { stars: 73000, commit_count_4_weeks: 142 },
      market_data: {
        market_cap: { usd: 1890000000000 },
        total_volume: { usd: 45000000000 },
        circulating_supply: 19800000,
        total_supply: 21000000,
        max_supply: 21000000,
      },
    });
    const { coingecko } = await import('@/lib/providers/crypto/coingecko');

    const r = await coingecko.cryptoMetrics!('BTC');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.rank).toBe(1);
    expect(r.data.githubCommits4w).toBe(142);
    expect(r.data.marketCap).toBe(1890000000000);
  });

  it('omits null supply fields rather than coercing them to zero', async () => {
    mockFetch({
      id: 'ethereum',
      symbol: 'eth',
      name: 'Ethereum',
      market_cap_rank: 2,
      market_data: {
        market_cap: { usd: 400000000000 },
        circulating_supply: 120000000,
        total_supply: null,
        max_supply: null, // ETH has no cap; zero here would read as "fully diluted"
      },
    });
    const { coingecko } = await import('@/lib/providers/crypto/coingecko');

    const r = await coingecko.cryptoMetrics!('ETH');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.maxSupply).toBeUndefined();
    expect(r.data.circulatingSupply).toBe(120000000);
  });
});

describe('error classification', () => {
  it('maps upstream 429 to rate_limited', async () => {
    mockFetch({ error: 'too many requests' }, 429);
    const { finnhub } = await import('@/lib/providers/equity/finnhub');

    const r = await finnhub.quote!('AAPL');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('rate_limited');
  });

  it('maps a rejected credential to upstream_error, distinct from "not configured"', async () => {
    mockFetch({ error: 'invalid api key' }, 401);
    const { finnhub } = await import('@/lib/providers/equity/finnhub');

    const r = await finnhub.quote!('AAPL');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('upstream_error');
  });
});

describe('credential hygiene', () => {
  it('never emits an API key into a log line', async () => {
    const lines: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (m: string) => {
      lines.push(String(m));
    };
    console.error = (m: string) => {
      lines.push(String(m));
    };

    try {
      mockFetch({ error: 'invalid api key' }, 401);
      const { finnhub } = await import('@/lib/providers/equity/finnhub');
      await finnhub.quote!('AAPL');
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    // The adapter logs the request URL on an auth rejection, and Finnhub carries
    // its credential as ?token=. It must be redacted before it reaches the sink.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain('test-key');
      expect(line).toContain('REDACTED');
    }
  });

  it('strips the credential from HttpError.url and .message', async () => {
    const { HttpError } = await import('@/lib/http');
    const err = new HttpError(
      401,
      'nope',
      'https://finnhub.io/api/v1/quote?symbol=AAPL&token=sk-secret-123',
    );

    expect(err.url).not.toContain('sk-secret-123');
    expect(err.message).not.toContain('sk-secret-123');
    expect(err.url).toContain('REDACTED');
    // The non-secret parts stay intact so the error is still diagnosable.
    expect(err.url).toContain('symbol=AAPL');
  });

  it('leaves non-credential query parameters untouched', async () => {
    const { scrubUrl } = await import('@/lib/logger');
    const clean = scrubUrl(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin',
    );
    expect(clean).toBe(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin',
    );
  });
});
