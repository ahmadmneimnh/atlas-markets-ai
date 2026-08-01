# Authentication

Auth.js v5 with database sessions. Google, Apple, GitHub and email magic links.

**Sign-in is optional infrastructure.** Market data and AI scores work signed
out; an account adds watchlists, portfolios and alerts. Everything below can be
skipped and the app still runs.

---

## Switching it on

Three things must all be present, or `isAuthConfigured` is false and the sign-in
page says so rather than showing buttons that fail on click:

1. `AUTH_SECRET` — `npm run auth:secret`
2. `DATABASE_URL` — sessions are rows, not JWTs
3. At least one provider below

```bash
cp .env.example .env
npm run auth:secret          # paste the output into .env
npm run infra:up
npm run db:push
npm run dev
```

---

## Google

<https://console.cloud.google.com/apis/credentials> → Create credentials → OAuth
client ID → Web application.

- Authorised JavaScript origin: `http://localhost:3000`
- Authorised redirect URI: `http://localhost:3000/api/auth/callback/google`

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

The provider requests `prompt=consent&access_type=offline`. Google issues a
refresh token only on first consent otherwise, so a user who re-authenticates
silently loses offline access.

---

## GitHub

<https://github.com/settings/developers> → New OAuth App.

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

```bash
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Scope is `read:user user:email`. Without `user:email`, GitHub can return a null
email and the adapter creates an account with no address — no password recovery,
no alerts.

---

## Apple

The most involved of the four, and the only one that expires.

1. <https://developer.apple.com/account/resources/identifiers> → an App ID, then
   a **Services ID** (this is your `APPLE_CLIENT_ID`).
2. Configure the Services ID: domain `localhost` is rejected, so local testing
   needs a tunnel (ngrok, Cloudflare Tunnel) or a `/etc/hosts` alias with HTTPS.
   Return URL: `https://your-domain/api/auth/callback/apple`.
3. Keys → new key with "Sign in with Apple" enabled. Download the `.p8` **once**
   — Apple will not show it again.

```bash
APPLE_CLIENT_ID=com.example.atlas.web
APPLE_TEAM_ID=XXXXXXXXXX
APPLE_KEY_ID=YYYYYYYYYY
APPLE_PRIVATE_KEY_PATH=./AuthKey_YYYYYYYYYY.p8
npm run auth:apple-secret     # prints APPLE_CLIENT_SECRET=...
```

`APPLE_CLIENT_SECRET` is **not a static string**. Apple requires a short-lived
ES256 JWT signed with that key, valid at most six months. When it expires, Apple
sign-in stops working with no other warning — put the expiry in a calendar. The
script prints the expiry to stderr for exactly that reason.

Keep the `.p8` out of the repository. It is a private key; `.gitignore` does not
cover a file you place somewhere unexpected.

---

## Email magic links

Any SMTP server.

```bash
EMAIL_SERVER_HOST=smtp.example.com
EMAIL_SERVER_PORT=587
EMAIL_SERVER_USER=...
EMAIL_SERVER_PASSWORD=...
EMAIL_FROM="Atlas Markets AI <no-reply@example.com>"
```

Links expire in **15 minutes**, not the 24-hour default. A working sign-in link
sitting in an inbox for a day is a full account takeover for anyone who reaches
that mailbox later.

---

## How authorisation actually works

**Sessions are database rows, not JWTs.** A JWT cannot be revoked before it
expires, so banning a user or changing their role would not take effect until
their token aged out. One indexed lookup per request buys immediate revocation.

**Permissions are capabilities, not role checks.** Call sites ask
`can(user.role, 'admin:users')`, never `user.role === 'ADMIN'`. Moving a
capability between roles is then one line in `lib/auth/permissions.ts` rather
than a grep across the codebase where the one missed call site is a privilege
bug.

| Role    | Gets                                                              |
| ------- | ----------------------------------------------------------------- |
| `USER`  | Watchlists, portfolios, alerts, notifications, profile            |
| `PRO`   | + unlimited alerts, API keys, data export, advanced screener      |
| `ADMIN` | + user management, feature flags, key rotation, queues, audit log |

**`middleware.ts` is routing convenience, not authorisation.** It runs on the
Edge runtime where Prisma cannot, so it only checks whether a session cookie is
present — a forged cookie gets past it. Every protected page and route handler
calls `requireUser()` or `requirePermission()`, which verifies. Treating
middleware as the security boundary is the classic Next.js mistake: it moves
authorisation to the one place in the stack that cannot reach the database.

**Someone else's resource returns 404, not 403.** A 403 confirms the id exists,
which turns any `/api/watchlists/{id}` into an enumeration oracle.

---

## Troubleshooting

**`OAuthAccountNotLinked`** — that email already has an account created through a
different provider. Deliberate: automatic linking by email address lets anyone
who can receive mail at an address take over an account created with it.

**Callback URL mismatch** — the provider's registered URL must match exactly,
including scheme, port and trailing path. `http://localhost:3000/...` and
`http://127.0.0.1:3000/...` are different URLs to every OAuth provider.

**Works locally, fails behind a proxy** — set `AUTH_URL` to the public origin.
Auth.js builds the callback URL from the request Host header, which a proxy
rewrites.

**Apple stops working after a few months** — the client secret expired. Re-run
`npm run auth:apple-secret`.
