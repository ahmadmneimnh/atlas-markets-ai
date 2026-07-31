# Development roadmap

Ten phases. Written to be honest about what is built and verified versus what is
designed but not wired up — a roadmap that overstates completion is worse than none.

Legend: ✅ built and verified · ⚠️ partial · ❌ not started

---

## Phase 1 — Architecture and setup ✅ **(current phase, complete)**

**Delivered**

- npm-workspaces monorepo: `apps/web`, `services/worker`, `services/ai-engine`,
  `packages/{core,db,config}`, `infra/`, `docs/`.
- Next.js 15 App Router, React 19, TypeScript strict with `noUncheckedIndexedAccess`,
  Tailwind driven by a shared token preset, Shadcn/UI wired to that preset, Framer
  Motion with reduced-motion honoured.
- `packages/core` — cross-service contracts as Zod schemas: queue and job names, job
  payloads, the scoring wire format, retry policy.
- `packages/db` — Prisma schema (users, OAuth, assets, score history, watchlists,
  lot-based portfolios, alerts, provider telemetry, feature flags, audit log), client
  singleton, seed.
- `services/worker` — four BullMQ queues, five repeatable schedules, boundary payload
  validation, structured logging, graceful shutdown. **Verified end to end against a
  live Redis**: schedules register, jobs are consumed, and invalid payloads, unknown
  jobs and unimplemented handlers each fail with the correct distinct error.
- `services/ai-engine` — FastAPI, validated settings, structlog JSON logging,
  constant-time shared-secret auth, Pydantic mirror of the wire contract, scoring
  pipeline seams, Prometheus `/metrics`. 7 tests pass; `/v1/score` answers **501**
  rather than inventing a number.
- `infra/` — compose with `default` / `full` / `observability` profiles, three
  Dockerfiles, Prometheus config, provisioned Grafana datasource.
- Documentation: architecture, database, API, AI engine, observability, local setup,
  this roadmap, annotated `.env.example`.

**Verified**: `npm install` → `npm run dev` serves localhost:3000 · 70/70 TypeScript
tests pass · clean `tsc --noEmit` across four workspaces · clean ESLint · production
build succeeds · worker boots and processes jobs · AI engine serves and refuses
correctly.

**Known liabilities, recorded rather than hidden**

- Factor weights exist in both `apps/web/src/lib/analysis/factors/*.ts` and
  `services/ai-engine/app/scoring/registry.py`. Resolved in Phase 4 when the scorers
  move; until then a weight change means editing both.
- The tracked universe in `apps/web/src/lib/universe.ts` is not yet seeded into
  Postgres. It moves to `packages/core` in Phase 2 so the seed and the app read one
  copy — seeding a second copy now would create the drift this is avoiding.
- `npm audit` reports high-severity advisories in transitive dev dependencies
  (`postcss` and `sharp` pinned inside Next 15; `minimatch`/`brace-expansion` under
  ESLint's plugins). None is reachable at runtime and none can be fixed without
  leaving Next 15. Re-check when Next 16 is adopted.

---

## Phase 2 — Authentication and database ⚠️

- ✅ Complete Prisma schema; validates against Postgres.
- ❌ NextAuth wiring, OAuth apps (Google / Apple / GitHub), session middleware, route
  protection, RBAC for the admin panel.
- ❌ Committed migration history (`db push` works; no migrations yet).
- ❌ Move `universe.ts` into `packages/core` and seed `Asset` from it.

**Blocked on**: registered OAuth applications and their secrets, which cannot be
provisioned from a build environment. A half-wired auth layer is worse than none.

**Unblocks**: phases 7, 8 and the useful half of 9.

---

## Phase 3 — Market data ingestion ✅ (adapters) / ❌ (scheduled)

- ✅ Capability-routed provider registry with priority, fallthrough, and
  `ATLAS_PRIORITY_*` env override — the documented vendor-swap mechanism.
- ✅ Adapters: **Finnhub** (quote, profile, fundamentals, news, search),
  **CoinGecko** (crypto quote, metrics, OHLC, search), **Binance** (crypto quote,
  klines), **Alpha Vantage** (daily OHLCV, fundamentals).
- ✅ 21 adapter tests over recorded response shapes, covering the quirks that matter:
  Finnhub's all-zero payload for unknown symbols, Alpha Vantage's HTTP-200 rate-limit
  body, string-typed numerics, null supply fields, reverse-ordered series.
- ❌ TwelveData, FMP, Polygon, CoinMarketCap, NewsAPI adapters. Interface and env
  slots exist; each is one file.
- ❌ Wiring the `market-data` queue handlers. Data is pulled on request behind the
  cache today, which is correct at this scale and will need a scheduled warmer past a
  few hundred assets.
- ❌ **Verify the adapters against live endpoints.** The build environment's network
  policy denies market-data hosts, so parsing is tested against recorded shapes but
  _not_ against what those endpoints return today. This is the first thing to check
  on a machine with open network access, and everything else rests on it.

---

## Phase 4 — AI scoring engine ✅ (TypeScript) / ❌ (Python)

- ✅ Six-factor weighted composite with renormalization on missing factors and a 25%
  coverage floor below which it refuses to score.
- ✅ Confidence computed independently of score, from coverage × evidence depth.
- ✅ Full citation trail: every signal carries value, direction, weight and source.
- ✅ 13 engine tests covering renormalization, the neutral-fill anti-case, confidence
  independence, the refusal path and scorer-crash containment; 36 indicator tests
  including RSI against Wilder's published worked example.
- ⚠️ News factor is a lexicon classifier with deliberately capped confidence.
- ❌ Move the scorers into `services/ai-engine`; register them; have the BFF call it.
- ❌ Replace the lexicon with a transformer classifier (FinBERT or similar).
- ❌ Persist `ScoreSnapshot`. Without stored inputs the weights can never be
  backtested or tuned — **the engine cannot improve until this exists**.
- ❌ Social and macro factors, which report unavailable by design until providers
  exist.

---

## Phase 5 — Dashboard ✅

Top AI buys/sells, biggest movers, the full scored universe, and an explicit
"could not be scored" section listing each asset with its reason rather than
omitting it silently.

❌ Heatmap, Fear & Greed index, economic calendar, earnings calendar — each
provider-gated.

---

## Phase 6 — Asset detail pages ✅

Quote with provenance, OHLC stats, the full recommendation explanation (ranked
reasons, factor breakdown showing nominal → effective weight, prominent "factors not
scored" panel), company profile, news feed.

❌ TradingView chart embed, financial statements, analyst ratings, insider trades,
institutional ownership — all provider-gated.

---

## Phase 7 — Portfolio and watchlists ❌

Schema is complete and deliberately lot-based. The pages state their dependency
rather than rendering an empty shell that reads as "you have no holdings".

**Blocked on Phase 2.**

---

## Phase 8 — Alerts ❌

`Alert` + `AlertDelivery` modelled with per-channel delivery rows, so one channel's
failure cannot mark another as sent. The `alerts` and `notifications` queues exist
and are wired; the handlers refuse with "not implemented until Phase 8".

Needs channel integrations: email, web push, SMS, Telegram, Discord.

---

## Phase 9 — Admin panel ⚠️

- ✅ Read-only system view: provider configuration status, capability map, factor
  weights. `/api/health` exposes the same without leaking key values.
- ❌ User management, key rotation, feature-flag editing, queue inspection, log
  viewer. All require Phase 2 — an admin panel without authorization is a liability,
  not a feature.

---

## Phase 10 — Testing, optimisation, deployment, documentation ⚠️

- ✅ 77 unit tests (70 TypeScript, 7 Python), clean strict typecheck, clean lint,
  production build, three Dockerfiles, compose profiles, seven documents.
- ❌ Integration tests against live provider endpoints (see Phase 3).
- ❌ E2E tests (Playwright), CI pipeline, load testing.
- ❌ OpenTelemetry tracing, Sentry, the web and worker Prometheus exporters.
- ❌ Production deployment: managed Postgres and Redis, image registry, secret
  management, migration-on-deploy.

---

## Recommended next three steps

1. **Wire Phase 2** — NextAuth plus Postgres. It is the hard dependency for phases 7,
   8 and the useful half of 9, and nothing else unblocks as much.
2. **Run the adapters against live endpoints** and reconcile any drift from the
   recorded shapes. Every score in the system rests on this being right.
3. **Persist `ScoreSnapshot`.** It is the difference between an engine that produces
   numbers and one that can be shown to be getting better.
