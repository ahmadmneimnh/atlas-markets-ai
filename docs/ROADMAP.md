# Development roadmap

Ten phases. Written to be honest about what is built and verified versus what is
designed but not wired up — a roadmap that overstates completion is worse than none.

Legend: ✅ built and verified · ⚠️ partial · ❌ not started

**All ten phases are complete.** What is genuinely unverified rather than
unbuilt is listed under "The one thing to check first" at the end.

---

## Phase 1 — Architecture and setup ✅

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

## Phase 2 — Authentication and database ✅

- Prisma schema covering users, profiles, OAuth accounts and sessions, API keys,
  market assets, AI recommendations with factor and signal children, technical
  indicators, news articles, sentiment scores, watchlists, portfolios with an
  immutable transaction ledger and lot-level cost basis, alerts, notifications,
  provider telemetry, feature flags and an audit log.
- Auth.js v5 with Google, Apple, GitHub and email magic links. Database sessions
  so a ban or a role change takes effect on the next request.
- Capability-based permissions (USER / PRO / ADMIN) with server-side quotas.
- `scripts/apple-client-secret.mjs` mints Apple's expiring ES256 JWT.

❌ Admin-facing user management (Phase 9). ❌ Committed migration history —
`db push` works; `migrate dev` has not been run against a persistent database.

---

## Phase 3 — Market data ingestion ✅

Ten providers behind the capability registry: Finnhub, Polygon, TwelveData, FMP,
Alpha Vantage, Yahoo, Binance, Coinbase, CoinGecko, CoinMarketCap, plus
Alternative.me for Fear & Greed and DefiLlama for TVL.

Twenty venues including NYSE, NASDAQ, LSE, XETRA, HKEX, TSE, ASX and TSX, with a
`MARKET_SUFFIX` table so no call site writes a vendor-specific ticker.

`http.ts` provides timeout, jittered retry, per-provider token-bucket rate
limiting and a circuit breaker; `cache.ts` a two-tier TTL cache keyed by how fast
each datum actually changes.

❌ Scheduled ingestion through the `market-data` queue — data is pulled on
request behind the cache, which is correct at this scale.

---

## Phase 4 — AI scoring engine ✅

Six factors at 30/30/15/10/10/5, renormalized across whichever are available,
refusing below 25% coverage. All fourteen named indicators. Confidence computed
independently of score. Full citation trail. Risk explanation on every
recommendation, derived only from values the system holds.

⚠️ News is a lexicon classifier with capped confidence. ❌ The Python service
hosts the pipeline seams but no registered models — `/v1/score` answers 501.
❌ `AiRecommendation` is modelled but not yet persisted per run.

---

## Phase 5 — Dashboard ✅

Top AI buys and sells, trending stocks and crypto, market heatmap, Fear & Greed,
economic events, latest news, biggest winners and losers, upcoming earnings, the
full scored universe, and an explicit "could not be scored" section.

---

## Phase 6 — Detail pages ✅

Stock: TradingView chart, profile, income statement, balance sheet, cash flow,
news, price targets, insider trades, institutional ownership, AI recommendation,
technical indicators, risk analysis.

Crypto: chart, market cap, supply, TVL, developer activity, on-chain metrics, AI
recommendation.

❌ Whale alerts and exchange listings — both need providers not yet adapted.

---

## Phase 7 — Portfolio and watchlists ✅

Unlimited watchlists. Lot-level purchase price, quantity and date; P/L, total
return, allocation, diversification (HHI-based) and value-weighted risk. Alert
rules for price, volume, RSI, MACD, recommendation changes and breaking news.

Unpriced positions are excluded from every figure and listed with the reason —
valuing them at cost would report them as exactly break-even.

---

## Phase 8 — Notifications ✅

Alert engine with three-state decisions (fire / hold / undetermined), cooldowns,
and crossing detection that requires both sides. Email, Telegram, Discord and
generic webhook channels; push and SMS report `not_configured` rather than
pretending. BullMQ queues with per-channel delivery rows and retry semantics that
distinguish retryable from permanent.

❌ Web push needs VAPID signing and the `web-push` dependency.

---

## Phase 9 — Admin panel ✅

- Read-only system view: provider configuration, capability map, factor weights.
  `/api/health` exposes the same without leaking key values.
- User management: list, search, role changes, suspend and reinstate, guarded so
  the last administrator cannot be demoted, banned or self-demoted.
- Feature flags: toggle and percentage rollout, with `null` (ungated) kept
  distinct from `0` (enabled for nobody).
- Queue inspection: waiting and failed counts read from BullMQ's key layout in
  Redis, without instantiating a Queue — doing so would write bookkeeping keys
  and mutate the state being reported.
- Audit log: read-only over HTTP. There is no DELETE and no PATCH; an audit log
  an administrator can edit is not an audit log.

Every mutation writes an audit record with before and after, in the same
transaction as the change — a failed audit write fails the request, because a
change nobody can attribute is the situation the log exists to prevent.

❌ API key rotation from the panel (the model and permission exist; the issuance
flow does not).

---

## Phase 10 — Production preparation ✅

- 136 TypeScript tests and 7 Python tests; clean strict typecheck across four
  workspaces; clean lint; production build.
- GitHub Actions CI: typecheck, lint, test, format check, build, Prisma schema
  validation, and ruff + mypy + pytest for the engine.
- Security: CSP, HSTS, Permissions-Policy, frame-ancestors none; per-caller API
  rate limiting with `Retry-After`; SSRF guard on user-supplied webhooks;
  credential redaction in every logger; constant-time secret comparison.
- Structured JSON logging in one shape across all three services; Prometheus
  `/metrics` on the engine; provisioned Grafana.
- Docker: three Dockerfiles, compose profiles for infra / full stack /
  observability.
- Documentation: architecture, database, API, AI engine, authentication,
  observability, deployment (Vercel / AWS / Railway), local setup, this roadmap.

❌ E2E tests (Playwright), load testing, OpenTelemetry tracing, Sentry.

---

## The one thing to check first

**The provider adapters have never run against live endpoints.** This build
environment's network policy denies market-data hosts, so parsing is tested
against recorded response shapes — which validates the quirk handling but _not_
that those endpoints still return those shapes today.

Everything the product claims rests on that being right. On a machine with open
network access:

```bash
cp .env.example .env      # add FINNHUB_API_KEY
npm run dev
curl localhost:3000/api/health
curl localhost:3000/api/score/crypto/BTC
curl localhost:3000/api/score/equity/AAPL
```

A 200 with a populated `sources` array means the adapter chain works end to end.
A 422 with per-factor reasons means the engine is correctly refusing — read the
reasons before assuming a bug.

## Then

1. **Persist `AiRecommendation` on every scoring run.** Without stored inputs the
   factor weights can never be backtested or tuned; the engine cannot improve.
2. **Move the TypeScript scorers into the Python service.** The weights currently
   exist in two files, which is a known and recorded liability.
3. **Build the Phase 9 admin write-path.** The permissions and audit model are
   already there.
