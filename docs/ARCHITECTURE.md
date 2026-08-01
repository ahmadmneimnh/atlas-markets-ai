# Architecture

Phase 1 is one job: get real market data onto a screen, and be honest when it cannot.
Phase 2 adds a second: turn that data into an explainable verdict, and be equally
honest about what it could not measure. Everything below serves those two.

## Layers

```
app/          pages + API routes        may import components, lib
components/   presentation only         may import lib types and formatters
lib/          providers, cache, http    may import nothing above it
lib/analysis/ the engine                may import lib/providers, never components
```

The dependency arrow points one way. A component that can reach a provider is a
component that will eventually fetch during render, so components never import
`lib/providers/registry`; they receive serialised DTOs.

`lib/env.ts` imports `server-only`, which means any accidental import of it from a
client component fails the build rather than shipping an API key to a browser.

## Provider layer

```
                 ┌─────────────────┐
 market.quote →  │    registry     │ → capability → [provider, provider, …]
 market.ohlcv →  │  (routing +     │
 market.search → │   caching)      │
                 └─────────────────┘
                          │
   ┌──────────┬───────────┼───────────┬────────────┐
 finnhub  alphavantage  coingecko  binance      (next vendor)
```

A provider declares *what it can do*, not what it is:

```ts
capabilities: ['crypto.quote', 'crypto.ohlcv']
```

The registry resolves a capability to an ordered list of configured providers and
tries them in turn. Two consequences worth stating:

- **Crypto and equity capabilities are separate names** even where the payload shape
  is identical (`ohlcv` vs `crypto.ohlcv`). Binance answers "no such symbol" for
  `AAPL`, and the registry treats an affirmative `not_found` as final — so a shared
  capability would make a correctly-configured stock chart fail permanently.
- **`not_found` short-circuits, everything else falls through.** If one vendor says
  the symbol does not exist, asking three more spends their quota to reach the same
  answer. If one vendor times out, the next gets a turn.

Ordering is overridable per deployment with `BB_PRIORITY_*` environment variables,
which is the documented way to swap a vendor without touching code.

## Never inventing data

Three mechanisms, in increasing order of how much they save you:

1. `ProviderResult<T>` is a discriminated union, not `T | null`. The compiler will
   not let a caller read `.data` without handling the failure branch.
2. Units are fixed by the domain type, not by the vendor. `Fundamentals.marketCap`
   is in whole currency units and every rate is a percentage; adapters scale
   whatever their vendor sends. A P/E of 0.253 displayed as 25.3% would be an
   invented figure.
3. Adapters translate vendor-specific "success" responses that are actually
   failures: Finnhub answers `200` with an all-zero quote for an unknown ticker
   (would render as `$0.00`), and Alpha Vantage answers `200` with its quota message
   in a `Note` field (would render as "this stock has no history").

Everything that reaches the UI as a failure carries a machine-readable `reason`,
which `explainUnavailable()` turns into one sentence a non-technical user can act
on.

## HTTP and caching

`lib/http.ts` wraps every outbound call with a timeout, bounded retry with full
jitter, a **per-provider** token bucket, and a circuit breaker.

Rate limits are per-provider rather than global because free tiers differ by orders
of magnitude — Alpha Vantage allows 25 requests *per day*, Binance ~1200 per minute.
One shared limiter would either throttle the generous vendor into uselessness or
burn the strict vendor's daily quota in seconds.

`lib/cache.ts` is a TTL cache whose keys are chosen by how fast each datum actually
changes: 15s for a crypto quote, 60s for a stock quote, 6h for daily bars, 24h for
fundamentals. Failures are cached too, but only for 30s — caching an error as long
as a success would hide a provider's recovery.

The cache is what makes chart range switching free: the API route always fetches a
year of daily bars and slices per range, so 1W → 1Y → 3M costs one upstream request,
not three.

## Refresh model

Pages server-render their first paint from live data, then hand off to a client
component that polls a JSON route. Polling stops while the tab is hidden and fires
immediately when it becomes visible again — a dashboard left open in a background
tab would otherwise spend a free-tier quota on a screen nobody is looking at, and
would show one interval of stale data on return.

## Theme

Colours are CSS variables holding RGB channels, redefined under `.dark`, exposed to
Tailwind as semantic tokens (`bg-surface`, `text-ink-muted`, `text-bull`). Components
carry no `dark:` variants for colour. The theme class is set by a small inline script
in `<head>` before first paint, because React's first render happens after paint and
would flash white.

## The analysis engine (Phase 2)

```
                    ┌──────────────┐
   engine.ts  ──►   │  technical   │──┐
   (the only        ├──────────────┤  │
    file that       │ fundamental  │──┤
    does I/O)       ├──────────────┤  ├──►  scoring.ts  ──►  Recommendation
                    │    market    │──┤       weights          + risk.ts
                    ├──────────────┤  │       conviction       + levels.ts
                    │  sentiment   │──┘       probabilities
                    └──────────────┘          confidence
```

Every module is a pure function from its inputs to a `ModuleResult`, which is either
a score with evidence or an explicit unavailability with a reason. That shape is what
lets the same modules serve an asset page, an API route and the scanner without any
of them re-deriving anything.

### Why weights are redistributed rather than defaulted

An unavailable module could be scored as a neutral 50. It is not, because that would
be a claim: it would say "we looked and found nothing notable" when the truth is "we
could not look". Redistribution keeps the verdict on the evidence that exists, and
the confidence rating carries the cost of what is missing. Below 50% of the nominal
weighting, no verdict is issued at all.

### Why probabilities are computed from module votes

Buy/Hold/Sell could be read off the conviction score with a lookup table. Instead
each module emits a soft triple which is averaged by applied weight, so genuine
disagreement between modules shows up as mass on both sides rather than being
flattened into a single number. Confidence then shifts mass toward Hold, and largest-
remainder rounding guarantees the three integers total exactly 100.

### Why the technical module never sees a fabricated bar

Indicators return `undefined` when the history cannot support them, and the module
skips those signals rather than substituting a neutral value — an RSI zero-filled for
its first thirteen bars reads as "extremely oversold" on every newly listed asset.
CoinGecko's `/ohlc` carries no volume, so volume signals are skipped entirely for
series that come from it rather than being computed from zeros.

### Cost control

The market context — regime, breadth, sector strength — is built once every 30
minutes and passed into every asset's analysis. Rebuilding it per asset would turn
one benchmark read into twenty, which on a 25-request-a-day free tier is the
difference between working and not. The scanner batches four assets at a time and
caches its whole result for five minutes.

## Deliberately absent

No database, no authentication, no background jobs. Watchlists, portfolios and alerts
all imply persistence and identity, and the engine is stateless by design: every
verdict is recomputed from live data, so there is no stored score that can quietly go
stale. Score history and alerting are the natural first use for a database when one
is added.
