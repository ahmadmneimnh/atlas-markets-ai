# Deployment

Atlas is four deployable units: the Next.js app, the BullMQ worker, the Python
scoring engine, and Postgres + Redis. Which of them a platform can host is what
makes the three options below different.

---

## What every deployment needs

| Requirement                  | Why                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `AUTH_SECRET`                | Signs session cookies. Generate with `npm run auth:secret`.                     |
| `DATABASE_URL`               | Postgres. Migrations run with `npm run db:migrate:deploy`.                      |
| `REDIS_URL`                  | Required by the worker. The app runs without it (in-process LRU).               |
| `NODE_ENV=production`        | The AI engine refuses to start without `AI_ENGINE_API_KEY` when this is set.    |
| At least one market-data key | Otherwise only crypto works. `FINNHUB_API_KEY` is the highest-value single key. |

**Never** set `NEXT_PUBLIC_*` for anything secret. That prefix is the instruction
to inline the value into the browser bundle, and no amount of care elsewhere
takes it back out.

---

## Vercel

Best fit for the **web app alone**. Vercel runs serverless functions, and the
worker is a long-lived process with repeatable schedules — it cannot live here.

```bash
vercel link
vercel env add AUTH_SECRET production
vercel env add DATABASE_URL production
vercel env add FINNHUB_API_KEY production
vercel deploy --prod
```

Project settings:

- **Root directory**: leave at the repository root. Vercel detects the workspace
  and builds `apps/web`; pointing it at `apps/web` breaks resolution of the
  `packages/*` dependencies, which live above it.
- **Build command**: `npm run db:generate && npm run build`
- **Install command**: `npm ci`

Two things that will bite:

**Connection pooling is not optional.** Each serverless invocation opens its own
Postgres connection, and a traffic spike exhausts the connection limit long
before it exhausts anything else. Use a pooled connection string (Neon, Supabase
pooler, PgBouncer in transaction mode) for `DATABASE_URL`, and set `DIRECT_URL`
to the unpooled one — migrations need a session-mode connection that transaction
pooling does not provide.

**The worker still has to run somewhere.** Vercel Cron can hit an API route on a
schedule, which covers periodic scoring, but it will not give you retries,
backoff or a queue. Run the worker on Railway or a small VM alongside.

---

## Railway

The only option here that hosts **all four units** without extra pieces, which
makes it the simplest complete deployment.

```bash
railway init
railway add --plugin postgresql
railway add --plugin redis
```

Then three services from the same repository:

| Service   | Start command                                      | Notes                                                   |
| --------- | -------------------------------------------------- | ------------------------------------------------------- |
| web       | `npm run start`                                    | Build: `npm ci && npm run db:generate && npm run build` |
| worker    | `npm run start -w @atlas/worker`                   | No public port.                                         |
| ai-engine | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | Root: `services/ai-engine`                              |

Railway injects `DATABASE_URL` and `REDIS_URL` from the plugins. Set
`ATLAS_API_URL` on the worker to the web service's internal URL — the worker
reads market data through the BFF so rate limiters stay in one process.

Run migrations as a deploy step on the web service:
`npm run db:migrate:deploy`.

**Run exactly one worker replica** unless you have thought about it. BullMQ
handles multiple consumers correctly, but `WORKER_SCHEDULES_ENABLED=true` on
several replicas registers the same repeatable jobs repeatedly — set it on one
replica and `false` on the rest.

---

## AWS

The most work and the most control. The shape that matches this codebase:

| Unit      | Service                                                            |
| --------- | ------------------------------------------------------------------ |
| web       | ECS Fargate behind an ALB, or App Runner                           |
| worker    | ECS Fargate, no load balancer, `desiredCount: 1` for the scheduler |
| ai-engine | ECS Fargate behind internal service discovery                      |
| Postgres  | RDS or Aurora Serverless v2                                        |
| Redis     | ElastiCache                                                        |
| Secrets   | Secrets Manager, injected as task-definition `secrets`             |

Images build from the Dockerfiles in `infra/docker/`. The web and worker builds
take the **repository root** as context — they depend on workspace packages that
live outside their own directories:

```bash
docker build -f infra/docker/Dockerfile.web    -t atlas-web    .
docker build -f infra/docker/Dockerfile.worker -t atlas-worker .
docker build -f infra/docker/Dockerfile.ai-engine -t atlas-ai services/ai-engine
```

Points worth getting right:

- **Give the worker a real stop grace period.** 40s or more. `stop_grace_period`
  in the compose file exists because SIGTERM has to reach the Node process and
  in-flight jobs need to drain; killing it early leaves jobs locked until
  BullMQ's stall timeout, after which they are retried despite having completed.
- **Put the AI engine on a private subnet.** It authenticates with a shared
  secret, but that is defence in depth, not the boundary.
- **Run migrations as a one-off ECS task**, not in the container's entrypoint.
  An entrypoint migration runs once per task, so a scale-out event runs N
  concurrent migrations against one database.
- Health check paths: `/api/health` for web, `/health` for the engine. Use
  `/health`, not `/ready` — readiness is 503 until factor models are registered,
  and an orchestrator would restart-loop a perfectly healthy container.

---

## Post-deployment checklist

```bash
curl https://your-domain/api/health          # which providers are configured
curl https://your-domain/api/auth/session    # null when signed out, never 500
curl -I https://your-domain                  # CSP and HSTS present
```

- [ ] `npm run db:migrate:deploy` ran, and `prisma migrate status` is clean
- [ ] `/api/health` lists the providers you expect as `configured: true`
- [ ] A sign-in provider works end to end, including the OAuth callback URL
- [ ] The worker's log shows `schedule registered` five times
- [ ] Apple's client secret expiry is in a calendar — it silently breaks sign-in
      within six months (`npm run auth:apple-secret` re-mints it)
- [ ] Rate limiting: it is per-instance and in-memory, so N replicas means N×
      the configured limit. Move the counter to Redis before scaling out.

---

## Rollback

Images are immutable and the database is not, so the two roll back differently.

Application: redeploy the previous image tag.

Database: **do not** roll a migration back under load. The expand/contract
pattern in `docs/DATABASE.md` exists so that the previous application version
still runs against the new schema — which makes an application rollback safe on
its own, and a schema rollback unnecessary in the common case.
