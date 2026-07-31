# Atlas Markets AI — Architecture

## 1. The governing constraint

> Never fabricate market data. Every displayed number must come from an API.

This is not a code-review guideline, it is a structural constraint, and it drives most of
the decisions below. Concretely, it means:

1. **There is no mock data module and no seed file containing prices.** Nothing in this
   repository can produce a plausible-looking quote. If you grep for a hardcoded price you
   will not find one — the only numbers in source are indicator constants (RSI period 14,
   etc.) and scoring weights.
2. **Absence is a first-class state.** Every provider call returns a discriminated union,
   `ProviderResult<T>` = `{ ok: true, data, source, asOf }` | `{ ok: false, reason }`.
   There is no `T | null` that a caller can accidentally coerce to `0`.
3. **Provenance travels with the value.** A `Quote` carries the provider that produced it
   and the timestamp it was observed. The UI renders both. A number with no provenance
   cannot be displayed, because the display components require the field.
4. **The scoring engine degrades instead of guessing.** If fundamentals are unavailable,
   the fundamental factor is not scored 50/100 ("neutral") — it is dropped and the
   remaining weights are renormalized, with the omission reported in the output. A score
   built from 3 of 6 factors says so.

The failure mode this design prevents is the one that matters for this product: a user
seeing a confident "STRONG BUY, 92%" that was computed from placeholder inputs.

## 2. System shape

```
                    ┌──────────────────────────────────────────┐
                    │  Next.js 15 (App Router, RSC)            │
                    │  UI + BFF API routes                     │
                    └───────────────┬──────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────────┐
                    │  Domain core (pure TypeScript)           │
                    │  indicators · factor scorers · engine    │
                    │  no I/O, no framework, fully unit-tested │
                    └───────────────┬──────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────────┐
                    │  Provider layer (the swap seam)          │
                    │  registry → capability-routed adapters   │
                    └───┬───────────┬───────────┬──────────────┘
                        │           │           │
                   Finnhub     CoinGecko    NewsAPI   … (adapters)
                        │           │           │
                    ┌───▼───────────▼───────────▼──┐
                    │  http client: retry, timeout, │
                    │  rate limit, circuit breaker  │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────▼──────────────┐
                    │  Cache (Redis, in-proc dev)  │
                    └──────────────────────────────┘

   Postgres + Prisma ── users, watchlists, portfolios, alerts, score history
```

### Why a BFF rather than a separate API service

At this stage the only consumer is the web app, so a separate backend service would buy
nothing but a network hop and a deployment. The domain core is already framework-free
(`src/lib/analysis/**` imports nothing from Next), so when a second consumer appears —
a mobile client, or the Python microservices in the spec — it lifts out into its own
service without a rewrite. That is the cheap version of the option; paying for it now is
not.

### Where Python fits

The spec calls for Python microservices for AI analysis. The seam for that is
`FactorScorer` (§5): each scorer is an interface, and a scorer whose implementation is an
HTTP call to a Python service satisfies it identically to a local one. Nothing else in the
system needs to know. The factors that will plausibly move to Python are news and social
sentiment (transformer inference); the deterministic ones — technical, risk — have no
reason to leave TypeScript, since the math is a few hundred lines and running it in-process
avoids a network round trip per asset.

## 3. Provider layer — the swap seam

Requirement: *"the architecture should allow swapping data providers without rewriting the
application."*

The mechanism is **capability-based routing**. A provider does not declare "I am Finnhub";
it declares which capabilities it implements:

```ts
type Capability = 'quote' | 'ohlcv' | 'fundamentals' | 'profile'
               | 'news' | 'crypto.quote' | 'crypto.metrics' | 'search';

interface Provider {
  id: string;                          // 'finnhub'
  capabilities: Capability[];
  isConfigured(): boolean;             // are the required env keys present?
  quote?(symbol: string): Promise<ProviderResult<Quote>>;
  // … one optional method per capability
}
```

The registry resolves a capability to an ordered list of configured providers and calls
them in priority order, falling through on failure:

```ts
const quote = await registry.get('quote', 'AAPL');
// tries finnhub → twelvedata → alphavantage, returns the first ok result,
// or { ok: false, reason: 'no_provider_configured' } if none have keys
```

Swapping providers is therefore an **environment change, not a code change**:
`ATLAS_PROVIDER_PRIORITY_QUOTE=twelvedata,finnhub`. Adding a provider is one file
implementing `Provider` plus one line in the registry — no call site changes, because no
call site names a provider.

The consequence worth stating plainly: adapters are responsible for normalizing into the
domain types in `src/lib/providers/types.ts`, and that normalization is where provider
quirks are absorbed (Finnhub's `c/h/l/o/pc` shorthand, CoinGecko's nested `market_data`,
Alpha Vantage's string-typed numerics and its habit of returning HTTP 200 with a rate-limit
message in the body). If a quirk leaks past the adapter it becomes everyone's problem, so
adapters are the one place where defensive parsing is expected rather than discouraged.

### Rate limits are per-provider, not global

Free tiers differ by two orders of magnitude (Alpha Vantage: 25 req/day; Binance public:
1200 req/min). A single global limiter would either throttle Binance to uselessness or blow
Alpha Vantage's quota in a minute. Each adapter declares its own budget and gets its own
token bucket, keyed by provider id.

## 4. Caching

Cache TTL is a function of how fast the underlying number actually changes:

| Data | TTL | Rationale |
|---|---|---|
| Quote (crypto) | 15 s | 24/7 market, moves continuously |
| Quote (equity) | 60 s | Free tiers are delayed 15 min anyway; sub-minute polling buys nothing |
| OHLCV daily bars | 6 h | A daily bar is final once the session closes |
| Fundamentals | 24 h | Changes quarterly |
| News | 10 min | Headline latency tolerance |
| Computed score | 5 min | Bounded by its fastest input |

Two-tier: an in-process LRU (survives a request, not a deploy) in front of Redis (shared
across instances). In development Redis is optional — the in-process tier alone is correct,
just colder. The cache stores `ProviderResult`, so a *failure* is cached briefly (30 s) as
well; this is deliberate, since a provider that is rate-limiting you will keep
rate-limiting you, and hammering it makes the outage longer.

## 5. Scoring engine

Six factors, each a `FactorScorer`:

```ts
interface FactorScorer {
  factor: Factor;                  // 'technical' | 'fundamental' | …
  weight: number;                  // nominal weight, from the spec
  score(ctx: AssetContext): Promise<FactorResult | Unavailable>;
}

interface FactorResult {
  score: number;                   // 0–100
  confidence: number;              // 0–1, how much evidence backed it
  signals: Signal[];               // the citations
}

interface Signal {
  label: string;                   // 'RSI(14) oversold'
  value: string;                   // '27.4'
  direction: 'bullish' | 'bearish' | 'neutral';
  weight: number;                  // contribution within the factor
  source: string;                  // provider id — the audit trail
}
```

Weights per the spec: technical 30, fundamental 30, news 15, social 10, macro 10, risk 5.

**Renormalization on missing factors.** If a factor returns `Unavailable`, its weight is
removed from the denominator rather than being scored as neutral. Scoring an unknown as 50
is the same error as fabricating data — it manufactures a number that no evidence supports,
and worse, it drags every score toward the middle so that genuinely strong and genuinely
unknown assets become indistinguishable.

**Confidence is separate from score.** Score answers "how good does this look"; confidence
answers "how much do we actually know". An asset with one working factor can score 80 —
it will just carry low confidence, and the UI leads with that. The two must not be
collapsed into one number, because a low-confidence 80 and a high-confidence 65 call for
different actions from the user.

`Recommendation` bands: 0–30 Strong Sell · 31–45 Sell · 46–55 Hold · 56–70 Buy ·
71–100 Strong Buy.

Every recommendation persists to `ScoreSnapshot` with its full signal list, so a past call
can be audited against what was actually known at the time. This is also what makes the
engine improvable later: without stored inputs, backtesting the weights is impossible.

## 6. Data model

See `prisma/schema.prisma`. Shape:

- **Identity** — `User`, `Account`, `Session` (OAuth: Google / Apple / GitHub / email).
- **Instruments** — `Asset` is the join point for both markets, keyed `(market, symbol)`,
  with `AssetKind` discriminating equity vs crypto. One table rather than two, because
  watchlists, portfolios, alerts, and scores all treat them uniformly; the kind-specific
  fields live in `EquityProfile` / `CryptoProfile` rows.
- **User data** — `Watchlist` → `WatchlistItem`, `Portfolio` → `Position` → `Lot`.
  Lots, not a single average cost, because tax treatment and realized P/L need purchase
  dates, and collapsing them early throws that away irrecoverably.
- **Engine output** — `ScoreSnapshot` + `ScoreSignal`, append-only, time-series.
- **Alerts** — `Alert` (rule) + `AlertDelivery` (per-channel dispatch record, so a
  Telegram failure doesn't silently mark an email alert as sent).
- **Ops** — `ProviderCall` (usage/quota telemetry), `FeatureFlag`, `AuditLog`.

Money is `Decimal`, never `Float`. Timestamps are `DateTime` in UTC; market-local time is
derived at render from the exchange's timezone, since storing local time makes every
cross-market query wrong.

## 7. Security

- API keys are server-only, read through `src/lib/env.ts`, which validates at boot and
  fails loudly on a malformed key rather than at 3am on the first request. No key is ever
  imported into a client component; the `NEXT_PUBLIC_` prefix is used for nothing but the
  site URL.
- All provider calls happen in RSC or route handlers. The browser never talks to a data
  vendor, so keys cannot leak through devtools and vendor CORS/referrer rules are moot.
- Rate limiting on the app's own API routes is per-user, not per-IP, once authenticated —
  per-IP alone is defeated by any NAT and punishes shared networks.
- `AuditLog` records admin actions (key rotation, flag changes, user mutation) with actor,
  target, before/after.

## 8. Repository layout

```
src/
  app/                      Next routes (UI + /api BFF)
  components/               presentational; no data fetching, no provider imports
  lib/
    analysis/               PURE domain core — indicators, factor scorers, engine
      indicators.ts         RSI, MACD, EMA/SMA, VWAP, ATR, Bollinger, ADX, Ichimoku…
      factors/              one file per factor scorer
      engine.ts             weighting, renormalization, banding
    providers/              THE SWAP SEAM
      types.ts              domain types + ProviderResult
      registry.ts           capability routing, priority, fallthrough
      equity/ crypto/ news/ adapters
    http.ts                 timeout, retry w/ jitter, rate limit, circuit breaker
    cache.ts                two-tier TTL cache
    env.ts                  validated server config
    logger.ts               structured JSON logs
prisma/schema.prisma
tests/                      unit tests for the domain core
docs/
```

The dependency rule is one-directional and worth enforcing in review:
`app → lib/analysis → lib/providers → lib/http`. `lib/analysis` must never import from
`app`, and `components/` must never import from `lib/providers` — a component that can
reach a provider is a component that will eventually fetch during render.

## 9. Delivery phases

See `docs/ROADMAP.md` for the full breakdown and current status.
