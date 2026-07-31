# API architecture

Three API surfaces, with different consumers and different rules.

| Surface        | Base                           | Consumer             | Auth                        |
| -------------- | ------------------------------ | -------------------- | --------------------------- |
| BFF            | `apps/web` → `/api/*`          | The Atlas web client | Session cookie (Phase 2)    |
| Scoring engine | `services/ai-engine` → `/v1/*` | BFF and worker only  | `X-Atlas-Key` shared secret |
| Queue API      | BullMQ over Redis              | BFF → worker         | Network isolation           |

---

## 1. The BFF

Route handlers under `apps/web/src/app/api`. It exists to keep provider credentials
and provider-shaped responses out of the browser: the client asks for an Atlas
concept ("score AAPL") and never for a vendor's endpoint.

### Current routes

| Method | Path                         | Returns                                                                          |
| ------ | ---------------------------- | -------------------------------------------------------------------------------- |
| `GET`  | `/api/health`                | Provider configuration status, capability map, factor weights. Never key values. |
| `GET`  | `/api/search?q=`             | Asset search across configured providers                                         |
| `GET`  | `/api/score/{kind}/{symbol}` | Full recommendation with citation trail                                          |

### Planned

| Method            | Path                                         | Phase                      |
| ----------------- | -------------------------------------------- | -------------------------- |
| `GET/POST/DELETE` | `/api/watchlist[/{id}]`                      | 7                          |
| `GET/POST`        | `/api/portfolio`, `/api/portfolio/{id}/lots` | 7                          |
| `GET/POST/PATCH`  | `/api/alerts[/{id}]`                         | 8                          |
| `GET`             | `/api/assets/{kind}/{symbol}/history`        | 4 (needs stored snapshots) |
| `POST`            | `/api/admin/refresh`                         | 9                          |

### Status codes are a contract, not decoration

| Code          | Means                                 | Notably                                                      |
| ------------- | ------------------------------------- | ------------------------------------------------------------ |
| `200`         | Here is the answer                    |                                                              |
| `304`         | Unchanged since your `ETag`           | Score responses are large; the dashboard polls               |
| `400`         | Your request was malformed            | Failed Zod parse of params/body                              |
| `401` / `403` | Not signed in / not permitted         |                                                              |
| `404`         | No such asset                         | Distinct from "asset exists, cannot score it"                |
| `422`         | **The engine declines to score**      | Below the coverage floor. A _successful_ refusal — see below |
| `429`         | You are being rate limited            | Carries `Retry-After`                                        |
| `502`         | An upstream provider failed           | The failure is theirs; the client may retry                  |
| `503`         | A required provider is not configured | The failure is ours; retrying will not help                  |

**422 is the one that matters.** When fewer than 25% of factor weights can be
scored, the engine refuses and the route returns 422 with the reason each factor was
omitted:

```json
{
  "error": "insufficient_data",
  "asset": { "kind": "equity", "symbol": "XYZ" },
  "coverage": 0.15,
  "requiredCoverage": 0.25,
  "omitted": [
    { "factor": "fundamental", "reason": "No fundamentals provider configured" },
    { "factor": "news", "reason": "Provider returned no articles in window" },
    { "factor": "social", "reason": "No social provider implemented" }
  ]
}
```

The alternative — returning `50/100, HOLD, low confidence` — is a lie with a
confidence interval attached, and every consumer downstream will render it as a
recommendation.

### Error envelope

Every non-2xx body is the same shape, so the client has one error path:

```json
{ "error": "machine_readable_code", "message": "human sentence", "details": {} }
```

`error` is a stable string the client can branch on. `message` is for humans and may
change. `details` is optional and structured — never a stringified stack trace.

### Caching

Route handlers set `Cache-Control` from the volatility of what they return, and the
service layer holds a matching TTL cache:

| Datum         | TTL | Why                                                                 |
| ------------- | --- | ------------------------------------------------------------------- |
| Quote         | 30s | The dashboard's refresh interval; anything shorter just burns quota |
| OHLCV (daily) | 15m | The last candle is the only one that moves intraday                 |
| Fundamentals  | 12h | Changes quarterly                                                   |
| News          | 10m |                                                                     |
| Score         | 5m  | Bounded by its slowest input                                        |
| Search        | 1h  | Symbol lists are near-static                                        |

### Validation

Every route parses its params and body with Zod at the boundary. Not for tidiness:
`params` and `searchParams` arrive as `string | string[] | undefined` regardless of
what the type annotation claims, and a route that trusts its annotation is one
malformed query string away from a runtime error inside the engine.

---

## 2. The scoring engine API

FastAPI, `services/ai-engine`. Contract in `packages/core/src/contracts/scoring.ts`
(Zod) and `services/ai-engine/app/schemas/scoring.py` (Pydantic) — the same shapes,
both enforced at runtime, reconciled through `contractVersion`.

| Method | Path        | Returns                                               |
| ------ | ----------- | ----------------------------------------------------- |
| `GET`  | `/health`   | Liveness. Checks nothing but that the process is up   |
| `GET`  | `/ready`    | Readiness. **503 until factor models are registered** |
| `POST` | `/v1/score` | A score, a 422 refusal, or 501 while unimplemented    |
| `GET`  | `/metrics`  | Prometheus exposition                                 |

Liveness and readiness are separate because the orchestrator does different things
with the answers: a failed `/health` restarts the container, a failed `/ready` only
removes it from rotation. Reporting "not ready" on `/health` gets a healthy pod
killed in a restart loop.

**The engine makes no outbound provider calls.** `POST /v1/score` receives
pre-fetched inputs. Keys, rate limits and the circuit breaker stay in one place, and
an engine that cannot fetch cannot invent.

**Requests reject unknown fields** (`extra="forbid"`). The permissive default would
let a producer send `prise` instead of `price` and have the engine score against a
missing field — a wrong recommendation rather than an error.

**Version mismatches are rejected, not tolerated.** A request whose `contractVersion`
major differs from the engine's gets `409`. Optimistic parsing across a contract
change is how a silently-dropped field becomes a wrong number.

### Authentication

`X-Atlas-Key`, compared with `hmac.compare_digest`. Ordinary `==` on strings
short-circuits at the first differing byte and leaks the secret one character at a
time to anyone who can measure latency. The key is optional locally and mandatory
when `NODE_ENV=production`, where the service refuses to start without it.

---

## 3. The queue API

Job names and payload schemas in `packages/core/src/contracts/queues.ts`. The BFF
enqueues, the worker consumes; neither writes a string literal for a queue or job
name.

| Queue           | Jobs                                             |
| --------------- | ------------------------------------------------ |
| `market-data`   | `refresh-quotes`, `refresh-ohlcv`, `ingest-news` |
| `scoring`       | `score-asset`, `score-universe`                  |
| `alerts`        | `evaluate-alerts`                                |
| `notifications` | `deliver-notification`                           |

All four share a `atlas` Redis prefix — passed as BullMQ's `prefix`, not embedded in
the queue name, because BullMQ builds its keys as `{prefix}:{queue}:{id}` and rejects
a name containing `:`.

Payloads are validated **on consumption**, not only on enqueue. A job outlives a
deploy inside Redis, so when the producer's schema changes and the consumer rolls
forward, old payloads still arrive. Parsing at the boundary turns that into one clear
validation failure instead of an undefined read three calls deep.

Retries: 5 attempts, exponential backoff from 5s. A permanent failure — bad payload,
unknown job, unimplemented handler — throws `UnrecoverableError`, which fails once
instead of burning five backoff attempts on something that cannot succeed.

---

## 4. Versioning

The BFF's routes are unversioned while the web client is the only consumer and ships
with the server. The moment a second consumer exists that upgrades independently
(a mobile app), routes move under `/api/v1` — that is the point at which a breaking
change stops being a deploy and becomes a compatibility problem.

The engine API is versioned from day one (`/v1/score`) because it already has two
independent callers.
