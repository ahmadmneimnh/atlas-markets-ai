# What the engine cannot see yet

Phase 2 scores what the configured providers actually return. This is the list of
things it would need to score better, ordered by how much accuracy each one buys.
Nothing here is a bug: every gap below already shows on screen as **Insufficient
Data** with its reason, rather than being filled in with an estimate.

---

## 1. Intraday price data — affects every technical signal

**Now:** daily bars only (Binance klines for crypto, Alpha Vantage
`TIME_SERIES_DAILY` for stocks).

**The limit:** RSI, MACD and ADX on daily bars describe a multi-week picture. A
"fresh MACD crossover" is a crossover as of yesterday's close, not this morning. Any
intraday reversal, gap or volume spike is invisible.

**What would fix it:** a provider with intraday OHLCV on the free or cheap tier —
Twelve Data (800 requests/day, 1-minute bars), Polygon.io (unlimited 5-year
aggregates on the paid starter tier), or Alpaca Market Data (free IEX feed).
The adapter interface already accepts `'1h'`; only crypto currently serves it.

## 2. Stock price history without a 25/day ceiling — affects stock coverage

**Now:** Alpha Vantage's free tier, 25 requests per day shared across charts,
technicals and the market benchmark.

**The limit:** a single scanner run over ten tracked stocks spends ten of those.
Past the limit, the technical module for stocks reports rate-limited, which drops
40% of the scoring weight and, with fundamentals alone at 30%, can push an asset
below the 50% threshold where no verdict is issued at all.

**What would fix it:** Twelve Data, Polygon.io, Financial Modeling Prep or Tiingo.
Any of them removes the single biggest constraint on stock-side accuracy. The env
vars `TWELVE_DATA_API_KEY`, `FMP_API_KEY` and `POLYGON_API_KEY` were reserved in
Phase 1 for this; the adapters are not written yet.

## 3. Crypto news — the sentiment module is stock-only

**Now:** Finnhub company-news, filed against stock tickers. Crypto assets report
`not_supported`, so the sentiment module never votes for them and 10% of the weight
is redistributed on every crypto asset.

**What would fix it:** CryptoPanic (free tier, aggregated crypto headlines with
source voting), CoinDesk or CoinTelegraph RSS, or NewsAPI with per-asset query
terms. `NEWSAPI_KEY` was reserved in Phase 1.

## 4. Sentiment that understands sentences

**Now:** a transparent finance lexicon over headlines and summaries, weighted by
recency. Every score traces to the words that produced it.

**The limit:** a lexicon cannot read negation ("not expected to miss"), sarcasm, or
which company in a headline the sentiment attaches to. It also cannot tell a
forward-looking claim from a reported fact.

**What would fix it:** a provider-scored sentiment feed (Finnhub's news-sentiment
endpoint is premium; Marketaux and StockGeist both offer scored feeds), or a
model-based classifier run over the same headlines. Either way the module contract
stays the same — only the scoring function changes.

## 5. Institutional and positioning data — currently absent entirely

None of the configured providers expose insider transactions, institutional
ownership changes, short interest, or options flow. `Fundamentals.institutionalOwnership`
exists in the domain type and is never populated. These are the inputs that most
often explain a move the price and fundamentals cannot.

**What would fix it:** Finnhub premium (insider transactions, ownership), Quiver
Quantitative, or SEC EDGAR full-text search for Form 4 and 13F filings — EDGAR is
free but needs its own parsing layer.

## 6. Earnings calendar and estimates — the largest single-day risk is invisible

The engine cannot currently tell that a company reports earnings tomorrow. That is
the single most important thing to know before acting on a short-horizon technical
signal, and its absence is not currently surfaced as a warning because no provider
is configured to answer the question.

**What would fix it:** Finnhub's earnings calendar (free tier includes it — this is
the cheapest meaningful improvement on the list), or FMP's earnings calendar.

## 7. Sector strength from a real sector universe

**Now:** sectors are grouped from the ten tracked stocks, and a sector needs at
least three of them before its average is used at all.

**The limit:** "Technology is outperforming" currently means "the three to five
technology names on the tracked list are outperforming the other tracked names". It
is a real measurement of a small sample, not a sector reading.

**What would fix it:** sector ETF quotes (XLK, XLF, XLE and the rest) — one quote
each, well within Finnhub's limit — or a provider with sector aggregates. This is
mostly an implementation gap rather than a data one.

## 8. Macro context — no rates, inflation or dollar index

Market conditions currently mean "how is this asset class trading". They do not
include the interest-rate path, inflation prints, or the dollar, all of which move
both asset classes.

**What would fix it:** FRED (free, no key needed for many series) for rates, CPI and
DXY. A macro sub-module would slot into the market module without touching the
scorer.

## 9. Crypto on-chain and exchange-flow data

Supply, dominance and turnover come from CoinGecko. Active addresses, exchange
netflows, staking ratios and developer activity beyond a GitHub commit count are not
available on the free tier.

**What would fix it:** Glassnode, CryptoQuant or Santiment — all paid — or public
node RPC endpoints with a purpose-built indexer.

---

## What accuracy means here

None of the above makes the engine predictive. More data narrows the gap between
what the engine measures and what actually moves a price; it does not turn a
measurement into a forecast. The honest ranking of value for effort:

1. **Finnhub earnings calendar** — free, already-configured provider, removes the
   worst blind spot on short-horizon stock calls.
2. **Twelve Data or Polygon** — removes the 25/day stock ceiling and unlocks
   intraday bars in one change.
3. **CryptoPanic** — free, restores 10% of the scoring weight on every crypto asset.
4. **Sector ETF quotes** — no new provider, turns a small-sample proxy into a real
   sector reading.
5. **FRED macro series** — free, adds the context both asset classes actually trade on.
