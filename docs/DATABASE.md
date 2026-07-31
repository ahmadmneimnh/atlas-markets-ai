# Database architecture

Postgres 16 via Prisma. Schema: `packages/db/prisma/schema.prisma`.

---

## 1. Rules the schema follows

**Money and quantities are `Decimal`, never `Float`.** Binary floating point cannot
represent `0.1` exactly. Rounding drift in a portfolio's cost basis compounds over
every trade and is the kind of bug users notice once and never forgive. Prisma maps
`Decimal` to Postgres `NUMERIC`, which is exact.

**Timestamps are UTC.** Market-local time is derived at render from the exchange's
timezone. Storing local time makes every cross-market query wrong, and the bug only
shows up twice a year when a DST boundary lands mid-session.

**Engine output is append-only.** `ScoreSnapshot` rows are never updated. A
recommendation has to be auditable against what was actually known when it was made;
updating in place destroys exactly the evidence you need when someone asks why the
system said BUY last Tuesday.

**Cost basis is lot-based, not averaged.** `Lot` stores each purchase separately
rather than maintaining one running average on `Position`. Tax treatment and
holding-period rules need per-purchase dates, and averaging at write time destroys
that irrecoverably — you cannot reconstruct lots from an average. It costs one join.

**A missing datum is `NULL`, never a sentinel.** No `-1` for "unknown price", no
`0` for "no volume". A sentinel is indistinguishable from a real value in an
aggregate, and `AVG(price)` over a column with `-1` in it silently returns garbage.

---

## 2. Entity map

```
User ─┬─ Account       (OAuth links, NextAuth-compatible)
      ├─ Session
      ├─ Watchlist ──── WatchlistItem ──┐
      ├─ Portfolio ──── Position ── Lot ┤
      ├─ Alert ──────── AlertDelivery   │
      └─ AuditLog                       │
                                        ▼
                                      Asset ─┬─ EquityProfile
                                             ├─ CryptoProfile
                                             └─ ScoreSnapshot ── ScoreFactor ── ScoreSignal

ProviderCall    (telemetry: latency, status, quota consumption — no user link)
FeatureFlag     (operational toggles, percentage rollout)
```

`Asset` is the join point for everything user-owned. It is keyed by
`@@unique([symbol, market])` rather than symbol alone: `BTC` on a crypto venue and a
listed ticker of the same name are different instruments, and a symbol-only key
silently merges them.

---

## 3. The score history chain

`ScoreSnapshot → ScoreFactor → ScoreSignal` is three tables rather than one JSON
column, and the reason is the product's central promise.

A snapshot stores the composite score, the recommendation and the confidence. Each
`ScoreFactor` row stores that factor's score, its nominal weight, its **effective**
weight after renormalization, and — for a factor that could not be scored — the
reason instead of a number. Each `ScoreSignal` stores one cited data point with its
value, direction, within-factor weight and **source provider**.

Storing this as JSON would make it displayable but not queryable, and the questions
that make the engine improvable are all queries:

- Which factors are most often unavailable, and for which provider configuration?
- Does the technical factor's directional call correlate with 30-day forward return?
- Which provider supplied the signals behind our worst recommendations?

Without those, factor weights can never be tuned by anything but intuition.

**Retention.** Snapshots accumulate at roughly `assets × scoring runs per day`. At
500 assets scored twice hourly that is ~24k snapshots/day and ~150k factor rows.
Postgres does not care for a year; the plan is monthly partitioning on
`ScoreSnapshot.computedAt` once it does, with signals older than 90 days dropped and
the snapshot header kept indefinitely.

---

## 4. Indexing

Every index exists because of a specific query, and each is listed with it.

| Index                                                 | Query it serves                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Asset @@unique([symbol, market])`                    | Symbol lookup on every asset page; also the correctness constraint above                                                     |
| `Asset @@index([kind])`                               | Screener filtered to equities or crypto                                                                                      |
| `Asset @@index([name])`                               | Search-by-company-name                                                                                                       |
| `ScoreSnapshot @@index([assetId, computedAt])`        | "Latest score for this asset" and the history chart — one index serves both because the sort column trails the filter column |
| `ScoreSnapshot @@index([recommendation, computedAt])` | Dashboard's top buys/sells                                                                                                   |
| `WatchlistItem @@unique([watchlistId, assetId])`      | Prevents duplicate adds at the database rather than in a race-prone read-then-write                                          |
| `Alert @@index([assetId, active])`                    | Alert sweep: every active rule for an asset that just re-scored                                                              |
| `ProviderCall @@index([provider, createdAt])`         | Admin panel's per-provider latency and error rate                                                                            |

The composite ordering matters: `[assetId, computedAt]` serves a filter on `assetId`
with a sort on `computedAt`. Reversed, it serves neither well.

---

## 5. Migrations

`prisma migrate dev` for development, `prisma migrate deploy` in CI/CD. Migration
files are committed — a schema whose history exists only in someone's local shadow
database is not reproducible.

`db push` is for local scratch work only. It reconciles the database to the schema
without recording how, which is fine on a database you can drop and wrong on one you
cannot.

**Expand/contract for anything destructive.** A column rename ships as: add the new
column → backfill → write both → read new → stop writing old → drop old, across
separate deploys. The single-step rename is one migration and one rollback window in
which the running application references a column that no longer exists.

---

## 6. Connection management

`packages/db/src/index.ts` exports a `PrismaClient` singleton stashed on `globalThis`
in development. Next.js replaces modules on every hot reload; a fresh client per
reload means a fresh connection pool per reload, and Postgres starts refusing
connections after a few dozen saves. The failure looks exactly like a database
outage and is entirely self-inflicted.

In production the module graph is stable, so the global is unused. Behind a
connection-pooled deployment (PgBouncer, Prisma Accelerate, Neon), the pooled
connection string goes in `DATABASE_URL` and the direct one in `DIRECT_URL` for
migrations — migrations need a session-mode connection that transaction pooling does
not provide.

---

## 7. What is not in the database

**Market data.** No table stores a price, a candle or a fundamental. Those are
fetched through the provider layer and cached with a TTL matched to how fast each
datum actually changes. A `prices` table would become a second source of truth that
is always slightly wrong, and the moment it exists something will read from it
instead of from the provider.

The one exception is deliberate and bounded: the values _cited inside a
ScoreSnapshot_ are stored, because a recommendation's evidence has to be frozen at
the moment it was made. Those rows are historical record, not a data source, and
nothing reads them to answer "what is the price".
