import { describe, expect, it } from 'vitest';

import { resolveBestMatch, searchUniverse } from '@/lib/search/local';

/**
 * These cases are the ones a user notices when they are wrong. A generic fuzzy
 * matcher gets several of them wrong often enough to be irritating, which is why
 * the ranking here is explicit rather than a similarity score.
 */

describe('searchUniverse', () => {
  it('matches a ticker exactly, above every partial match', () => {
    const [top] = searchUniverse('AAPL');

    expect(top?.symbol).toBe('AAPL');
    expect(top?.matched).toBe('symbol');
  });

  it('matches a company name', () => {
    const [top] = searchUniverse('Apple');

    expect(top?.symbol).toBe('AAPL');
    expect(top?.matched).toBe('name');
  });

  it('matches a crypto symbol and a crypto name to the same asset', () => {
    expect(searchUniverse('BTC')[0]?.symbol).toBe('BTC');
    expect(searchUniverse('Bitcoin')[0]?.symbol).toBe('BTC');
    expect(searchUniverse('ETH')[0]?.symbol).toBe('ETH');
    expect(searchUniverse('Ethereum')[0]?.symbol).toBe('ETH');
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(searchUniverse('  tsla ')[0]?.symbol).toBe('TSLA');
    expect(searchUniverse('tEsLa')[0]?.symbol).toBe('TSLA');
  });

  it('ranks an exact symbol above a name that merely contains the query', () => {
    const results = searchUniverse('BTC');

    // Anything whose *name* contains "btc" must not outrank the ticker itself.
    expect(results[0]?.symbol).toBe('BTC');
  });

  it('matches a word inside a name but not an interior fragment', () => {
    // "motor" is a word in "Toyota Motor Corp." — a legitimate way to search.
    expect(searchUniverse('motor').some((h) => h.symbol === '7203')).toBe(true);

    // "otor" is an interior fragment; matching it is coincidence, not intent.
    const fragment = searchUniverse('otor');
    expect(fragment.every((h) => h.symbol !== '7203')).toBe(true);
  });

  it('filters by asset class when asked', () => {
    const crypto = searchUniverse('a', { kind: 'crypto', limit: 50 });

    expect(crypto.length).toBeGreaterThan(0);
    expect(crypto.every((h) => h.kind === 'crypto')).toBe(true);
  });

  it('returns nothing for an empty query rather than the whole universe', () => {
    expect(searchUniverse('')).toEqual([]);
    expect(searchUniverse('   ')).toEqual([]);
  });

  it('orders ties deterministically so the dropdown does not flicker', () => {
    const first = searchUniverse('a', { limit: 20 });
    const second = searchUniverse('a', { limit: 20 });

    expect(first.map((h) => h.symbol)).toEqual(second.map((h) => h.symbol));
  });
});

describe('resolveBestMatch', () => {
  it('resolves a ticker and a name straight to the asset', () => {
    expect(resolveBestMatch('AAPL')?.symbol).toBe('AAPL');
    expect(resolveBestMatch('bitcoin')?.symbol).toBe('BTC');
    expect(resolveBestMatch('tesla')?.symbol).toBe('TSLA');
  });

  it('refuses a weak match rather than navigating somewhere confident and wrong', () => {
    // "inc" appears mid-name in several companies. Landing on one of them would
    // present an authoritative-looking page for an asset the user never asked
    // about; a search results page is the honest response.
    expect(resolveBestMatch('inc')).toBeUndefined();
  });

  it('returns undefined for a query that matches nothing', () => {
    expect(resolveBestMatch('zzzzzz')).toBeUndefined();
  });
});
