# Local setup

Target: `C:\Users\Ahmad\Desktop\atlas-markets-ai` on Windows. The commands are
identical on macOS and Linux.

---

## Prerequisites

| Tool           | Version                     | Needed for                                                   |
| -------------- | --------------------------- | ------------------------------------------------------------ |
| Node.js        | 20.11+ (22 LTS recommended) | Everything. `.nvmrc` pins 22                                 |
| npm            | 10+                         | Ships with Node                                              |
| Git            | any                         | Cloning                                                      |
| Docker Desktop | any                         | Postgres and Redis. **Optional** — the app runs without them |
| Python         | 3.11+                       | The AI engine only. **Optional**                             |

---

## 1. Get the code onto your machine

```powershell
cd C:\Users\Ahmad\Desktop
git clone -b claude/atlas-markets-phase-1-pueknt https://github.com/ahmadmneimnh/atlas-markets-ai.git atlas-markets-ai
cd atlas-markets-ai
```

If the folder already exists from an earlier session:

```powershell
cd C:\Users\Ahmad\Desktop\atlas-markets-ai
git fetch origin claude/atlas-markets-phase-1-pueknt
git checkout claude/atlas-markets-phase-1-pueknt
git pull origin claude/atlas-markets-phase-1-pueknt
```

## 2. Install and run

```powershell
npm install
npm run dev
```

Open **http://localhost:3000**.

One `npm install` at the root installs every workspace — `apps/web`,
`packages/*` and `services/worker` — and links them together. Do not run
`npm install` inside a subfolder; it will create a nested `node_modules` that
shadows the workspace links.

**It runs with no API keys and no database.** Crypto data comes from CoinGecko's
public tier and Binance's public market-data endpoints, neither of which needs a
credential. The dashboard scores the crypto universe and shows a banner explaining
that equity coverage is off. Nothing is faked: an asset that cannot be scored is
listed with the reason.

## 3. Add API keys (optional)

```powershell
copy .env.example .env
```

Then set `FINNHUB_API_KEY` — the free tier at <https://finnhub.io/register> covers
quotes, profiles, fundamentals, news and search at 60 req/min, which turns on
equities entirely. Restart `npm run dev` after editing `.env`.

## 4. Add the database and queues (optional)

```powershell
npm run infra:up      # starts Postgres + Redis in Docker
npm run db:generate   # generate the Prisma client
npm run db:push       # create the tables
npm run db:seed       # feature flags
```

`db:push`, `db:migrate`, `db:seed` and `db:studio` read the root `.env`, so step 3
has to have happened first. `db:generate` does not.

Run the background worker in a second terminal:

```powershell
npm run dev:worker
```

Or both at once:

```powershell
npm run dev:stack
```

The worker registers its schedules and then refuses every job with "not implemented
until Phase N" — that is Phase 1 behaviour, and the refusal is deliberate. A handler
that returned success without doing work would give you a green dashboard for a
system doing nothing.

## 5. Run the AI engine (optional)

```powershell
cd services\ai-engine
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

<http://localhost:8000/docs> for the OpenAPI UI. `/health` returns 200, `/ready`
returns 503 (no factor models registered yet), and `POST /v1/score` returns 501.

## 6. Everything in Docker

```powershell
npm run stack:up
```

Builds and runs web, worker, ai-engine, Postgres and Redis together. Slower to
iterate on — no hot reload — but it is the closest thing to production.

---

## Command reference

| Command                                                        | Does                                 |
| -------------------------------------------------------------- | ------------------------------------ |
| `npm run dev`                                                  | Web app at localhost:3000            |
| `npm run dev:worker`                                           | BullMQ worker (needs Redis)          |
| `npm run dev:stack`                                            | Both, in one terminal                |
| `npm run build`                                                | Production build                     |
| `npm start`                                                    | Serve the production build           |
| `npm test`                                                     | Unit tests across all workspaces     |
| `npm run typecheck`                                            | `tsc --noEmit` across all workspaces |
| `npm run lint`                                                 | ESLint                               |
| `npm run format`                                               | Prettier, write                      |
| `npm run db:generate` / `push` / `migrate` / `seed` / `studio` | Prisma                               |
| `npm run infra:up` / `infra:down` / `infra:logs`               | Postgres + Redis                     |
| `npm run stack:up` / `stack:down`                              | Full containerised stack             |

---

## Troubleshooting

**`npm install` fails on a corporate network.** Behind a proxy, set
`npm config set proxy` and `https-proxy`. Behind TLS inspection, point npm at the
corporate CA with `npm config set cafile` — never `strict-ssl false`.

**Port 3000 is in use.** `npm run dev -- -p 3001`, or set `WEB_PORT` for the Docker
stack.

**`prisma` commands fail with "Environment variable not found: DATABASE_URL".** The
root `.env` does not exist yet. `copy .env.example .env`.

**The worker exits immediately with a Redis error.** Redis is not running.
`npm run infra:up`, or set `REDIS_URL` to a Redis you do have.

**The dashboard says everything is unavailable.** Either your network blocks the
provider hosts, or you are rate limited. `curl http://localhost:3000/api/health`
shows which providers are configured; the dev-server log shows
`provider_fallthrough` with a reason for each failure.

**Windows line endings.** `.gitattributes` normalises everything to LF on commit. If
Git reports every file as modified after a checkout, run
`git config --global core.autocrlf false` and re-clone.
