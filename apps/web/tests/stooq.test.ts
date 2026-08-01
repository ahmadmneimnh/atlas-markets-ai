import { describe, expect, it } from 'vitest';

import { parseStooqCsv, stooqSymbol } from '@/lib/providers/equity/stooq';

/**
 * Stooq's CSV parser.
 *
 * This is the free, keyless source of equity price history, and it is the only
 * reason a Finnhub-only deployment can score the technical factor at all. It is
 * also a hand-written parser over an untyped text format, which is exactly the
 * shape of code that silently produces a wrong number — so every malformed input
 * below asserts that the row is *dropped*, never coerced.
 */

const HEADER = 'Date,Open,High,Low,Close,Volume';

describe('parseStooqCsv', () => {
  it('parses a well-formed response', () => {
    const candles = parseStooqCsv(
      [HEADER, '2024-01-02,187.15,188.44,183.89,185.64,82488700'].join('\n'),
    );

    expect(candles).toHaveLength(1);
    expect(candles[0]?.open).toBe(187.15);
    expect(candles[0]?.high).toBe(188.44);
    expect(candles[0]?.low).toBe(183.89);
    expect(candles[0]?.close).toBe(185.64);
    expect(candles[0]?.volume).toBe(82488700);
    expect(candles[0]?.time.toISOString()).toBe('2024-01-02T00:00:00.000Z');
  });

  it('returns nothing for the "No data" body Stooq sends with HTTP 200', () => {
    // The failure mode this guards: an unknown symbol answers 200, so a parser
    // that trusts the status code would hand back an empty series as success.
    expect(parseStooqCsv('No data')).toEqual([]);
    expect(parseStooqCsv('')).toEqual([]);
  });

  it('drops a row with a non-numeric price rather than coercing it', () => {
    const candles = parseStooqCsv(
      [HEADER, '2024-01-02,187.15,188.44,183.89,,82488700', '2024-01-03,1,2,0.5,1.5,10'].join('\n'),
    );

    // Number('') is 0, and a 0 close is not a gap on a chart — it reads as a
    // real, total loss, and it would drag every indicator built on it.
    expect(candles).toHaveLength(1);
    expect(candles[0]?.close).toBe(1.5);
  });

  it('drops a row with a zero or negative price', () => {
    const candles = parseStooqCsv(
      [HEADER, '2024-01-02,0,0,0,0,0', '2024-01-03,-1,2,1,1.5,10'].join('\n'),
    );

    expect(candles).toEqual([]);
  });

  it('drops a row with an unparseable date', () => {
    const candles = parseStooqCsv([HEADER, 'not-a-date,1,2,0.5,1.5,10'].join('\n'));

    expect(candles).toEqual([]);
  });

  it('handles a series with no volume column', () => {
    const candles = parseStooqCsv(
      ['Date,Open,High,Low,Close', '2024-01-02,1,2,0.5,1.5'].join('\n'),
    );

    expect(candles).toHaveLength(1);
    // Zero rather than undefined: Candle.volume is required, and the indicators
    // that use it (volumeRatio, VWAP) already treat a zero total as "absent".
    expect(candles[0]?.volume).toBe(0);
  });

  it('rejects a response whose header is not Stooq’s', () => {
    expect(parseStooqCsv(['Foo,Bar', '1,2'].join('\n'))).toEqual([]);
  });

  it('tolerates CRLF line endings', () => {
    const candles = parseStooqCsv(`${HEADER}\r\n2024-01-02,1,2,0.5,1.5,10\r\n`);

    expect(candles).toHaveLength(1);
  });

  it('returns candles oldest-first even when the source is reversed', () => {
    const candles = parseStooqCsv(
      [HEADER, '2024-01-03,2,3,1,2.5,10', '2024-01-02,1,2,0.5,1.5,10'].join('\n'),
    );

    // Every indicator assumes ascending time. An out-of-order series would not
    // throw — it would quietly produce a wrong RSI.
    expect(candles.map((c) => c.time.toISOString().slice(0, 10))).toEqual([
      '2024-01-02',
      '2024-01-03',
    ]);
  });
});

describe('stooqSymbol', () => {
  it('lowercases and appends the US suffix', () => {
    expect(stooqSymbol('AAPL')).toBe('aapl.us');
    expect(stooqSymbol('brk.b')).toBe('brk.b.us');
  });
});
