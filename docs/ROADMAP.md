# Delivery roadmap

Status against the ten phases in the brief. This is written to be honest about what
is actually built and verified versus what is designed but not wired up, because a
roadmap that overstates completion is worse than no roadmap.

Legend: ✅ built and tested · ⚠️ partial · ❌ not started

---

## Phase 1 — Architecture and setup ✅

- Next.js 15 App Router, React 19, TypeScript strict (`noUncheckedIndexedAccess`),
  Tailwind with a semantic token palette.
- Layered structure with a one-directional dependency rule (see ARCHITECTURE.md §8).
- `http.ts`: timeout, jittered retry, per-provider token-bucket rate limiting,
  circuit breaker.
- `cache.ts`: two-tier TTL cache keyed by how fast each datum actually changes.
- Structured JSON logging with credential redaction.
- Docker Compose (Postgres + Redis), multi-stage Dockerfile, standalone output.

## Phase 2 — Authentication and database ⚠️

- ✅ Complete Prisma schema: users, OAuth accounts/sessions (NextAuth-compatible),
  assets, score history, watchlists, lot-based portfolios, alerts with per-channel
  delivery records, provider telemetry, feature flags, audit log. Validates against
  Postgres.
- ❌ NextAuth wiring, OAuth apps (Google / Apple / GitHub), session middleware,
  route protection.
- ❌ Migrations (`db:push` works; no migration history committed).

**Why it stopped here:** OAuth requires registered applications and secrets that
cannot be provisioned from this environment, and a half-wired auth layer is worse
than none.

## Phase 3 — Market data ingestion ✅

- Capability-routed provider registry with priority ordering, fallthrough, and
  env-var override (`ATLAS_PRIORITY_*`) — the documented vendor-swap mechanism.
- Adapters: **Finnhub** (quote, profile, fundamentals, news, search), **CoinGecko**
  (crypto quote, metrics, OHLC, search), **Binance** (crypto quote, klines),
  **Alpha Vantage** (daily OHLCV, fundamentals overview).
- 21 adapter tests over recorded response shapes, covering the quirks that matter:
  Finnhub's all-zero payload for unknown symbols, Alpha Vantage's HTTP-200
  rate-limit body, string-typed numerics, null supply fields, reverse-ordered series.
- ❌ TwelveData, FMP, Polygon, CoinMarketCap, Coinbase, NewsAPI adapters. The
  interface and env slots exist; each is one file.
- ❌ BullMQ background ingestion. Data is currently pulled on request behind the
  cache, which is correct for this scale but will need a scheduled warmer once the
  tracked universe grows past a few hundred assets.

## Phase 4 — AI scoring engine ✅

- Six-factor weighted composite with **renormalization on missing factors** and a
  25% coverage floor below which it refuses to score.
- Confidence computed independently of score, from coverage × evidence depth.
- Full citation trail: every signal carries value, direction, weight and source.
- 13 engine tests covering renormalization, the neutral-fill anti-case, confidence
  independence, the refusal path, and scorer-crash containment.
- 36 indicator tests including RSI against the published Wilder worked example.
- ⚠️ News factor is a lexicon classifier with capped confidence (see README).
- ❌ Social and macro factors report unavailable by design until their providers
  exist.
- ❌ Persisting `ScoreSnapshot` to Postgres (schema ready, needs the DB wired).

## Phase 5 — Dashboard ✅

Top AI buys/sells, biggest gainers/losers, full scored universe, and an explicit
"assets that could not be scored" section. Assets missing data are listed with the
reason rather than omitted silently.

❌ Heatmap, Fear & Greed index, economic calendar, upcoming earnings — each needs a
provider that is not yet adapted.

## Phase 6 — Asset detail pages ✅

Quote with provenance, OHLC stats, full recommendation explanation (ranked reasons,
expandable factor breakdown showing nominal → effective weight, and a prominent
"factors not scored" panel), company profile, news feed.

❌ TradingView chart embed, financial statements, analyst ratings, insider trades,
institutional ownership — all provider-gated.

## Phase 7 — Portfolio and watchlists ❌

Schema is complete and deliberately **lot-based** rather than storing a single
averaged cost basis: tax treatment and holding-period rules need per-purchase dates,
and averaging at write time destroys that irrecoverably. The pages state the
dependency instead of rendering an empty shell that reads as "you have no holdings".

Blocked on Phase 2.

## Phase 8 — Alerts ❌

`Alert` + `AlertDelivery` modelled, with per-channel delivery rows so one channel's
failure cannot mark another as sent. Needs BullMQ workers and channel integrations
(email, push, SMS, Telegram, Discord).

## Phase 9 — Admin panel ⚠️

- ✅ Read-only system view: provider configuration status, capability map, factor
  weights. `/api/health` exposes the same without leaking key values.
- ❌ User management, key rotation, feature-flag editing, log viewer. All require
  Phase 2 for authorization — an admin panel without auth is a liability.

## Phase 10 — Testing, optimization, deployment, documentation ⚠️

- ✅ 70 unit tests; clean strict typecheck; production build; Dockerfile and
  Compose; ARCHITECTURE.md, README, this roadmap, `.env.example`.
- ❌ Integration tests against live provider endpoints — **not runnable in the build
  environment**, whose network policy denies market-data hosts (403 at CONNECT).
  The adapters are tested against recorded response shapes instead, which validates
  parsing and quirk handling but *not* that the live endpoints still return those
  shapes. **This is the first thing to verify on a machine with open network
  access.**
- ❌ E2E tests, Sentry/OTel instrumentation, CI pipeline, load testing.

---

## Recommended next three steps

1. **Wire Phase 2** (NextAuth + Postgres). It is the hard dependency for phases 7,
   8 and the useful half of 9.
2. **Run the adapters against live endpoints** and reconcile any drift from the
   recorded shapes. Everything else rests on this being right.
3. **Persist `ScoreSnapshot`.** Without stored inputs, the factor weights can never
   be backtested or tuned — the engine cannot improve.
