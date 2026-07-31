# Atlas Markets AI

AI-scored Buy / Hold / Sell recommendations for global equities and cryptocurrency,
where every displayed number is traceable to the provider that supplied it.

## The one rule everything else follows

> Never fabricate market data.

This is enforced structurally, not by convention:

- **There is no mock data module and no price fixture.** Grep the source: the only
  numeric constants are indicator periods and scoring weights.
- **`ProviderResult<T>` is a discriminated union**, not `T | null`. A caller cannot
  quietly coerce a missing quote into `0`.
- **Provenance is a required field.** `Quote`, `Fundamentals` and every `Signal`
  carry `source` and `asOf`, and the display components require them.
- **Missing factors are dropped, not neutralised.** If fundamentals are unavailable
  the fundamental factor is removed from the denominator and the remaining weights
  are renormalized — it is _not_ scored 50/100. Scoring an unknown as "neutral"
  invents evidence and makes genuinely-average and completely-unknown assets
  indistinguishable.
- **The engine refuses to answer when it does not know.** Below 25% factor coverage
  it raises `InsufficientDataError` and the API returns **422** with the reason for
  every omitted factor, rather than a confident-looking number.

## Quick start

```bash
npm install
npm run dev               # → http://localhost:3000
```

That is the whole setup. One `npm install` at the root installs every workspace and
links them together — do not run it inside a subfolder.

Full instructions, including Windows, Docker and the optional services:
**[docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md)**.

**It runs with zero API keys.** Crypto is served by CoinGecko's public tier and
Binance's public market-data endpoints, neither of which needs a credential. The
dashboard will score the crypto universe and display a banner explaining that
equity coverage is off.

To enable equities, set one key — Finnhub's free tier covers quotes, profiles,
fundamentals, news and search at 60 req/min:

```bash
FINNHUB_API_KEY=your_key_here
```

Postgres and Redis are optional for browsing (an in-process LRU stands in for
Redis). They are required for watchlists, portfolios, alerts and score history:

```bash
cp .env.example .env
npm run infra:up          # postgres + redis in Docker
npm run db:generate
npm run db:push
```

## Verify it yourself

```bash
npm test                  # 70 unit tests across the workspaces
npm run typecheck         # strict tsc --noEmit, four workspaces
npm run lint
npm run build             # production build
curl localhost:3000/api/health              # which providers are configured
curl localhost:3000/api/score/crypto/BTC
```

`/api/health` reports provider configuration without ever returning a key value.

The Python engine is verified separately:

```bash
cd services/ai-engine
python -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
.venv/bin/python -m pytest        # 7 tests
```

## How swapping a data provider works

Call sites ask for a _capability_, never a vendor:

```ts
const quote = await market.quote('AAPL', 'equity');
// tries finnhub → twelvedata → alphavantage, first success wins
```

So changing vendors is an environment change:

```bash
ATLAS_PRIORITY_QUOTE=twelvedata,finnhub
ATLAS_PRIORITY_OHLCV=binance,coingecko
```

Adding a vendor is one file implementing the `Provider` interface plus one entry in
`apps/web/src/lib/providers/registry.ts`. No call site changes, because no call site
names a provider.

## Scoring

Six factors, weighted per spec, renormalized across whichever are available:

| Factor           | Weight | Status                                                                                                          |
| ---------------- | -----: | --------------------------------------------------------------------------------------------------------------- |
| Technical        |    30% | ✅ RSI, MACD, SMA/EMA, VWAP, ATR, Bollinger, Ichimoku, ADX, momentum, volume, 52w range, golden/death cross     |
| Fundamental      |    30% | ✅ Equities: P/E, PEG, growth, margin, ROE/ROIC, leverage, FCF. Crypto: rank, turnover, supply, dev activity    |
| News sentiment   |    15% | ⚠️ Deterministic finance lexicon with negation handling and recency decay. Confidence capped at 0.6 — see below |
| Social sentiment |    10% | ❌ Reports unavailable — needs Reddit / X / StockTwits credentials                                              |
| Macro            |    10% | ❌ Reports unavailable — needs a FRED adapter                                                                   |
| Risk             |     5% | ✅ Volatility, max drawdown, ATR%, range extension                                                              |

Bands: 0–30 Strong Sell · 31–45 Sell · 46–55 Hold · 56–70 Buy · 71–100 Strong Buy.

**Score and confidence are separate outputs and must stay that way.** Score says how
good the asset looks; confidence says how much was actually known. A low-confidence
80 and a high-confidence 65 call for different actions, and collapsing them into one
number erases that.

The social and macro factors return `unavailable` rather than a placeholder. That is
the design working as intended: their 20% of weight leaves the denominator and the
UI lists them under "Factors not scored".

### On the news classifier

It is a weighted lexicon, not a language model. That is transparent (every
classification traces to matched terms) and free, but plainly weaker than a
transformer on negation and context. Its confidence is therefore capped at 0.6 so it
never speaks with authority it has not earned. `classify()` in
`apps/web/src/lib/analysis/factors/news.ts` is the only function that inspects text —
the swap point for the Python service in `services/ai-engine`.

## Architecture

An npm-workspaces monorepo. Four deployable units, three shared packages.

```
apps/web/                 Next.js 15 — UI + BFF API routes
  src/app/                routes (pages + /api)
  src/components/         ui/ (Shadcn) · motion/ (Framer) · primitives.tsx
  src/lib/analysis/       PURE domain core — indicators, factor scorers, engine
  src/lib/providers/      THE SWAP SEAM — capability-routed adapters
  src/lib/http.ts         timeout · jittered retry · rate limit · circuit breaker
  src/lib/cache.ts        two-tier TTL cache (failures cached briefly too)
  tests/                  70 unit tests
services/worker/          BullMQ consumers + repeatable schedules
services/ai-engine/       Python 3.11 · FastAPI · scoring microservice
packages/core/            cross-service contracts (queues, scoring wire types)
packages/db/              Prisma schema, migrations, client singleton
packages/config/          shared tsconfig bases + Tailwind token preset
infra/                    compose profiles, Dockerfiles, Prometheus, Grafana
docs/                     architecture · database · API · AI engine · setup · roadmap
```

Dependency rule: `app → lib/analysis → lib/providers → lib/http`. `lib/analysis`
never imports from `app`; components never import a provider adapter — enforced by
`no-restricted-imports` in `apps/web/eslint.config.mjs`, not left to memory. Across
packages, dependencies point inward: nothing in `packages/` imports from `apps/` or
`services/`.

| Document                                  | Covers                                                   |
| ----------------------------------------- | -------------------------------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)   | System shape, provider seam, caching, security           |
| [DATABASE.md](docs/DATABASE.md)           | Data model, indexing, migrations, retention              |
| [API.md](docs/API.md)                     | Routes, status-code contract, error envelope, versioning |
| [AI_ENGINE.md](docs/AI_ENGINE.md)         | Scoring pipeline, factor plugins, refusal semantics      |
| [OBSERVABILITY.md](docs/OBSERVABILITY.md) | Logging, metrics, tracing, alerting                      |
| [LOCAL_SETUP.md](docs/LOCAL_SETUP.md)     | Running it on Windows, macOS, Linux                      |
| [ROADMAP.md](docs/ROADMAP.md)             | Phase-by-phase plan and honest status                    |

## Security

- API keys are server-only via `apps/web/src/lib/env.ts` and never reach a client bundle
  (enforced by the `server-only` import guard).
- **Credentials are stripped from URLs before logging.** Most vendors authenticate by
  query parameter, so an innocuous-looking `url` log field would otherwise carry a
  live secret; `scrubUrl()` redacts them, and `HttpError` sanitizes at construction
  so no downstream path can leak one. Regression-tested in `tests/providers.test.ts`.
- Placeholder values (`your-key-here`) are treated as absent, so a half-filled `.env`
  produces an honest "not configured" instead of confusing 401s.

## Status

**Phase 1 (architecture) is complete.** Phases 3–6 are built and tested. Authentication,
portfolios, watchlists, alerts and the admin write-path are modelled in the Prisma
schema but not wired up — those pages say so explicitly rather than rendering an
empty shell.

The worker and the Python engine ship their pipelines, contracts and refusals, not
their bodies: unimplemented job handlers fail with "not implemented until Phase N",
and `POST /v1/score` answers `501`. A handler that returned success without doing
work would give a green dashboard for a system doing nothing, and a placeholder score
is indistinguishable from a real recommendation to everything downstream.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full breakdown.

**Not investment advice.** Algorithmic scores from public data, for research only.
