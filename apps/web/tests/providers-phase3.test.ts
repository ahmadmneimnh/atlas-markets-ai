import { afterEach, describe, expect, it, vi } from 'vitest';

import { polygon } from '@/lib/providers/equity/polygon';
import { twelvedata } from '@/lib/providers/equity/twelvedata';
import { fmp } from '@/lib/providers/equity/fmp';
import { yahoo } from '@/lib/providers/equity/yahoo';
import { coinmarketcap } from '@/lib/providers/crypto/coinmarketcap';
import { coinbase } from '@/lib/providers/crypto/coinbase';

/**
 * These tests target the *quirks*, not the happy path.
 *
 * Every vendor here has at least one way of reporting failure that looks like
 * success to a naive parser — a 200 with an error body, numbers as strings,
 * nulls padding an array, a reversed series. Each of those is a way that
 * fabricated or wrong data reaches a user's screen, so each gets a test. The
 * happy path is the case that fails loudly when it breaks; these are the ones
 * that fail silently.
 */

function mockJson(body: unknown, init: ResponseInit = {}): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200, ...init }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('polygon', () => {
  it('reports rate_limited when a 200 body carries an error, not a bad quote', async () => {
    vi.stubEnv('POLYGON_API_KEY', 'test-key');
    mockJson({ status: 'ERROR', error: 'exceeded maximum requests per minute' });

    const result = await polygon.quote!('AAPL');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rate_limited');
  });

  it('dates a previous-close quote from the bar, not from now', async () => {
    vi.stubEnv('POLYGON_API_KEY', 'test-key');
    const barTime = Date.UTC(2026, 0, 15, 21, 0, 0);
    mockJson({
      status: 'OK',
      results: [{ T: 'AAPL', o: 100, h: 105, l: 99, c: 104, v: 1_000, t: barTime }],
    });

    const result = await polygon.quote!('AAPL');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.asOf.getTime()).toBe(barTime);
      expect(result.data.price).toBe(104);
      expect(result.data.changePercent).toBeCloseTo(4, 5);
    }
  });
});

describe('twelvedata', () => {
  it('parses string-typed numerics rather than passing strings through', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    mockJson({
      symbol: 'AAPL',
      close: '142.30',
      previous_close: '140.00',
      open: '140.50',
      volume: '12345678',
      percent_change: '1.642',
    });

    const result = await twelvedata.quote!('AAPL');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.data.price).toBe('number');
      expect(result.data.price).toBe(142.3);
      expect(result.data.volume).toBe(12_345_678);
    }
  });

  it('distinguishes its 429 envelope from a generic upstream error', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    mockJson({ status: 'error', code: 429, message: 'API credits limit reached' });

    const result = await twelvedata.quote!('AAPL');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rate_limited');
  });

  it('drops a candle whose OHLC will not parse instead of zero-filling it', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    mockJson({
      values: [
        { datetime: '2026-01-02', open: '10', high: '11', low: '9', close: '10.5', volume: '100' },
        { datetime: '2026-01-03', open: '', high: '', low: '', close: '', volume: '' },
        { datetime: '2026-01-04', open: '11', high: '12', low: '10', close: '11.5', volume: '120' },
      ],
    });

    const result = await twelvedata.ohlcv!('AAPL', '1d', 100);

    expect(result.ok).toBe(true);
    // Two candles, not three with a zero in the middle — a zero candle reads as a
    // 100% drawdown to every indicator downstream.
    if (result.ok) {
      expect(result.data.candles).toHaveLength(2);
      expect(result.data.candles.every((c) => c.close > 0)).toBe(true);
    }
  });

  it('drops a search hit whose venue it cannot map rather than guessing one', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    mockJson({
      data: [
        { symbol: 'AAPL', instrument_name: 'Apple Inc', exchange: 'NASDAQ', country: 'US' },
        { symbol: 'ENI', instrument_name: 'Eni SpA', exchange: 'MTA', country: 'Italy' },
      ],
    });

    const result = await twelvedata.search!('a');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.symbol).toBe('AAPL');
    }
  });
});

describe('fmp', () => {
  it('reads the "Error Message" quota envelope out of a 200', async () => {
    vi.stubEnv('FMP_API_KEY', 'test-key');
    mockJson({ 'Error Message': 'Limit Reach. Please upgrade your plan.' });

    const result = await fmp.quote!('AAPL');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rate_limited');
  });

  it('returns partial fundamentals when one plan-gated endpoint fails', async () => {
    vi.stubEnv('FMP_API_KEY', 'test-key');

    // key-metrics succeeds; ratios is 403 (plan-gated); growth succeeds.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('key-metrics-ttm')) {
        return new Response(JSON.stringify([{ peRatio: 28.4, roe: 0.31 }]), { status: 200 });
      }
      if (url.includes('ratios-ttm')) {
        return new Response('forbidden', { status: 403 });
      }
      return new Response(JSON.stringify([{ revenueGrowth: 0.08 }]), { status: 200 });
    });

    const result = await fmp.fundamentals!('AAPL');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.peRatio).toBe(28.4);
      expect(result.data.revenueGrowthYoY).toBe(0.08);
      // The plan-gated field is absent, not zero. The engine drops absent inputs
      // from the weighting; a zero would be scored as genuinely terrible.
      expect(result.data.profitMargin).toBeUndefined();
    }
  });

  it('treats an empty array as not_found rather than an empty quote', async () => {
    vi.stubEnv('FMP_API_KEY', 'test-key');
    mockJson([]);

    const result = await fmp.quote!('NOSUCH');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });
});

describe('yahoo', () => {
  it('skips null-padded rows instead of forward-filling them', async () => {
    const base = Math.floor(Date.UTC(2026, 0, 2) / 1000);
    mockJson({
      chart: {
        error: null,
        result: [
          {
            meta: { symbol: 'BP.L', regularMarketPrice: 5, currency: 'GBp' },
            timestamp: [base, base + 86_400, base + 172_800],
            indicators: {
              quote: [
                {
                  open: [1, null, 3],
                  high: [2, null, 4],
                  low: [0.5, null, 2.5],
                  close: [1.5, null, 3.5],
                  volume: [10, null, 30],
                },
              ],
            },
          },
        ],
      },
    });

    const result = await yahoo.ohlcv!('BP.L', '1d', 100);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candles).toHaveLength(2);
      expect(result.data.candles.map((c) => c.close)).toEqual([1.5, 3.5]);
    }
  });

  it('surfaces the chart error envelope as not_found', async () => {
    mockJson({ chart: { error: { code: 'Not Found', description: 'No data found' } } });

    const result = await yahoo.quote!('NOSUCH');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });
});

describe('coinmarketcap', () => {
  it('maps its rate-limit status codes to rate_limited, not upstream_error', async () => {
    vi.stubEnv('COINMARKETCAP_API_KEY', 'test-key');
    mockJson({ status: { error_code: 1008, error_message: 'minute rate limit reached' } });

    const result = await coinmarketcap.cryptoQuote!('BTC');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rate_limited');
  });

  it('derives absolute change from the percentage rather than reporting zero', async () => {
    vi.stubEnv('COINMARKETCAP_API_KEY', 'test-key');
    mockJson({
      status: { error_code: 0 },
      data: {
        BTC: {
          id: 1,
          name: 'Bitcoin',
          symbol: 'BTC',
          cmc_rank: 1,
          quote: { USD: { price: 110, percent_change_24h: 10, volume_24h: 5_000 } },
        },
      },
    });

    const result = await coinmarketcap.cryptoQuote!('BTC');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // 110 after +10% implies 100 before; change must be 10, not 0.
      expect(result.data.change).toBeCloseTo(10, 6);
      expect(result.data.previousClose).toBeCloseTo(100, 6);
    }
  });

  it('leaves developer activity undefined rather than reporting zero commits', async () => {
    vi.stubEnv('COINMARKETCAP_API_KEY', 'test-key');
    mockJson({
      status: { error_code: 0 },
      data: {
        BTC: {
          id: 1,
          name: 'Bitcoin',
          symbol: 'BTC',
          circulating_supply: 19_600_000,
          quote: { USD: { price: 100, market_cap: 2e12 } },
        },
      },
    });

    const result = await coinmarketcap.cryptoMetrics!('BTC');

    expect(result.ok).toBe(true);
    // Zero commits would be scored as an abandoned project; absent means "not known".
    if (result.ok) expect(result.data.githubCommits4w).toBeUndefined();
  });
});

describe('coinbase', () => {
  it('reverses its newest-first candles into chronological order', async () => {
    const t = Math.floor(Date.UTC(2026, 0, 3) / 1000);
    mockJson([
      [t + 172_800, 9, 12, 10, 11, 100],
      [t + 86_400, 8, 11, 9, 10, 90],
      [t, 7, 10, 8, 9, 80],
    ]);

    const result = await coinbase.ohlcv!('BTC', '1d', 100);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const times = result.data.candles.map((c) => c.time.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      // A reversed series turns an uptrend into a downtrend with no error raised.
      expect(result.data.candles.at(-1)?.close).toBe(11);
    }
  });

  it('quotes against a real USD product, not a USDT proxy', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/ticker')) {
        return new Response(
          JSON.stringify({ price: '105', volume: '42', time: '2026-01-05T00:00:00Z' }),
          {
            status: 200,
          },
        );
      }
      return new Response(JSON.stringify({ open: '100', high: '110', low: '95' }), { status: 200 });
    });

    const result = await coinbase.cryptoQuote!('BTC');

    expect(spy.mock.calls.some(([input]) => String(input).includes('BTC-USD'))).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.currency).toBe('USD');
      expect(result.data.changePercent).toBeCloseTo(5, 6);
    }
  });
});
