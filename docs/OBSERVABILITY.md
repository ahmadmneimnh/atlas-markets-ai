# Observability

The system's job is to be believed. That makes "was this number right, and where did
it come from" an operational question, not just a product one — which is why
provenance appears in the logs as well as the UI.

---

## 1. Logging

One JSON line per event, from all three services, in the same shape:

```json
{
  "ts": "2026-07-31T17:53:38.068Z",
  "level": "info",
  "service": "worker",
  "message": "job started",
  "context": { "queue": "scoring", "job": "score-asset", "id": "3" }
}
```

| Service              | Implementation                                   |
| -------------------- | ------------------------------------------------ |
| `apps/web`           | `src/lib/logger.ts`                              |
| `services/worker`    | `src/lib/logger.ts`                              |
| `services/ai-engine` | `app/core/logging.py` (structlog, JSON renderer) |

They are three small implementations rather than one shared package on purpose:
extracting a thirty-line logger into `packages/` couples every service's deploy to
it, and the coupling costs more than the duplication.

### Credential redaction is not optional

Both loggers scrub before serialising:

- Any key matching `/(api[_-]?key|token|secret|password|authorization)/i` → `[redacted]`
- Any URL query parameter matching `?apikey=`, `&token=`, `&key=` → `[redacted]`

Provider errors routinely echo the request URL back in the message, and those URLs
carry API keys as query parameters. Logging an error object verbatim is how a key
ends up in a log aggregator a dozen people can read. This has to happen at the
logger, not at each call site — one forgotten call site is one leaked key.

### Levels

| Level   | Use                                                                    |
| ------- | ---------------------------------------------------------------------- |
| `debug` | Per-provider request/response shape. Off in production                 |
| `info`  | Job lifecycle, score computed, provider fallthrough, cache miss        |
| `warn`  | Retry, circuit breaker opened, provider degraded, coverage below floor |
| `error` | Unhandled failure, dependency unreachable, invalid environment         |

`provider_fallthrough` is `warn`, not `error`: falling through to the next provider
is the registry working as designed. It becomes an error only when every provider for
a capability has failed.

---

## 2. Metrics

Prometheus. `services/ai-engine` exposes `/metrics` today; the web and worker
exporters are Phase 10 (`infra/monitoring/prometheus.yml` names the intended targets).

### The metrics that matter

| Metric                                                       | Type      | Why this one                                                                                                    |
| ------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------- |
| `atlas_queue_depth{queue}`                                   | gauge     | **The best leading indicator in the system.** It rises before any user notices anything                         |
| `atlas_job_duration_seconds{queue,job}`                      | histogram | p95, not mean — the mean hides the tail that causes timeouts                                                    |
| `atlas_job_failures_total{queue,job,reason}`                 | counter   | Split by reason: a validation failure and a provider outage need different responses                            |
| `atlas_provider_requests_total{provider,capability,outcome}` | counter   | Error rate per provider, and quota burn-down                                                                    |
| `atlas_provider_duration_seconds{provider}`                  | histogram | Catches a degrading vendor before it starts failing                                                             |
| `atlas_circuit_state{provider}`                              | gauge     | 0 closed / 1 half-open / 2 open                                                                                 |
| `atlas_score_coverage`                                       | histogram | Distribution of factor coverage. A leftward drift means data quality is degrading — usually invisible otherwise |
| `atlas_scores_refused_total{reason}`                         | counter   | How often the engine declines. A spike is a data-supply incident                                                |
| `atlas_cache_hits_total{key_kind}` / `misses`                | counter   | Hit rate directly determines provider quota consumption                                                         |

Deliberately **not** collected: anything keyed by user id or symbol as a label.
Per-symbol labels give a cardinality explosion at a few hundred assets, and that is
what kills a Prometheus instance.

---

## 3. Tracing

OpenTelemetry, Phase 10. One trace should span: browser request → BFF route →
service layer → provider HTTP call → engine call, plus the enqueue → worker → engine
path as a linked trace.

`traceId` is already carried on the `score-asset` job payload
(`packages/core/src/contracts/queues.ts`) for exactly this: without it, a slow score
cannot be traced back to the user action that queued it.

---

## 4. Health endpoints

| Endpoint                | Reports                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `GET /api/health` (web) | Provider configuration status, capability map, factor weights. Never key values |
| `GET /health` (engine)  | Liveness only                                                                   |
| `GET /ready` (engine)   | Readiness — 503 until factor models are registered                              |

Liveness and readiness are separate because the orchestrator acts differently on
each: a failed liveness check restarts the container, a failed readiness check only
removes it from rotation. Conflating them turns a temporarily-unready pod into a
restart loop.

---

## 5. Alerts worth paging for

| Condition                                       | Severity | Because                                                      |
| ----------------------------------------------- | -------- | ------------------------------------------------------------ |
| `atlas_queue_depth` rising for 15m              | page     | The system is falling behind; everything downstream is stale |
| Every provider for a capability circuit-open    | page     | That capability is fully dark                                |
| `atlas_scores_refused_total` rate > 20% for 10m | page     | The product is returning refusals to most users              |
| p95 job duration > 60s                          | ticket   | Degrading, not broken                                        |
| Provider error rate > 5% for 30m                | ticket   | One vendor is unwell; the registry is absorbing it           |
| Cache hit rate < 50%                            | ticket   | Quota burn will become an outage on the next billing tier    |

Explicitly **not** an alert: an individual scoring failure. Assets go missing from
providers routinely; the engine's refusal path handles it correctly, and paging on it
teaches people to ignore the pager.

---

## 6. Running the local observability stack

```bash
docker compose -f infra/docker-compose.yml --profile observability up
```

Prometheus on <http://localhost:9090>, Grafana on <http://localhost:3001>
(`admin` / `GRAFANA_PASSWORD`, default `atlas`). The Prometheus datasource is
provisioned, so Grafana comes up already pointed at it — clicking through a setup
wizard after every `docker compose down -v` is exactly the friction that makes people
stop looking at dashboards.
