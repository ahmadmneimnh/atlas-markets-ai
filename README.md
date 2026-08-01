# Batal's Brain

A live market dashboard for cryptocurrency and stocks. Prices, search, asset pages
and interactive charts — all from real market data providers, refreshed
automatically.

**This is Phase 1: the market data system.** There is deliberately no AI analysis,
scoring or recommendation anywhere in this app yet. That comes in Phase 2, once the
data layer is proven.

---

## What it does

| Feature | Where | Data source |
| --- | --- | --- |
| Live crypto prices | Homepage | CoinGecko (Binance as backup) |
| Live stock prices | Homepage | Finnhub |
| Top gainers and decliners | Homepage | calculated from the prices above |
| Search stocks and crypto | Search box, top of every page | Finnhub + CoinGecko |
| Asset detail page | Click any symbol | as above |
| Interactive price chart | Asset detail page | Binance (crypto), Alpha Vantage (stocks) |
| Automatic refresh | Everywhere | every 15–30 seconds |
| Dark and light mode | Button, top right | remembered in your browser |

**One rule this app follows everywhere:** it never makes a number up. If a data
source is missing, rate-limited or down, you see **"Insufficient Data"** and a plain
explanation of why — never a zero, a placeholder or an estimate.

---

## Setup, for someone who has never written code

You will need about ten minutes. Nothing here costs money.

### Step 1 — Install Node.js

Node.js is the program that runs this website on your computer.

1. Go to **<https://nodejs.org>**
2. Download the version labelled **LTS** (it will detect Windows or Mac for you).
3. Open the downloaded file and click through the installer, accepting the defaults.

### Step 2 — Open a terminal

The terminal is a window where you type commands.

- **Windows:** press the Start button, type `PowerShell`, press Enter.
- **Mac:** press `Cmd + Space`, type `Terminal`, press Enter.

To check Step 1 worked, type this and press Enter:

```bash
node --version
```

You should see something like `v22.11.0`. If you see "command not found", restart
your computer and try again.

### Step 3 — Go to the project folder

If you downloaded this project as a ZIP file, unzip it first. Then, in the terminal,
type `cd ` (the letters c and d, then a space), drag the project folder onto the
terminal window — it will paste the location for you — and press Enter.

To confirm you are in the right place, type `ls` (Mac) or `dir` (Windows) and press
Enter. You should see `package.json` in the list.

### Step 4 — Install the project's parts

```bash
npm install
```

This downloads the building blocks the site needs. It takes a minute or two and
prints a lot of text. That is normal.

### Step 5 — Add your API keys

An API key is a free password that lets this app ask a data company for prices.

**Cryptocurrency needs no key at all** — you can skip straight to Step 6 and the
crypto half of the dashboard will work immediately. Stocks need one free key.

1. Get a free Finnhub key: go to <https://finnhub.io/register>, sign up with your
   email (no card required), and copy the key it shows you.
2. *Optional, for stock charts:* get a free Alpha Vantage key at
   <https://www.alphavantage.co/support/#api-key>.
3. In the project folder, find the file called **`.env.example`**. Make a copy of it
   in the same folder and rename the copy to **`.env.local`** exactly.
4. Open `.env.local` in any text editor (Notepad, TextEdit, VS Code) and paste your
   keys after the `=` signs:

   ```
   FINNHUB_API_KEY=abc123yourkeyhere
   ALPHA_VANTAGE_API_KEY=xyz789yourkeyhere
   ```

   No quotes, no spaces around the `=`.
5. Save the file.

> Keep `.env.local` private — it is your key, and the project is already set up to
> never upload it.

### Step 6 — Start the site

```bash
npm run dev
```

Wait for the line that says `Ready`. Then open your browser to:

**<http://localhost:3000>**

That is Batal's Brain running on your own computer.

To stop it, click the terminal window and press `Ctrl + C`. To start it again later,
repeat Step 6 from the project folder.

---

## Frequently hit snags

| What you see | What it means | What to do |
| --- | --- | --- |
| "Insufficient Data" under **Stocks** | No Finnhub key was found | Redo Step 5, then stop and restart the app (Ctrl+C, `npm run dev`) |
| "Insufficient Data" on a stock's chart | No Alpha Vantage key, or its 25-a-day free limit is used up | Add the key, or wait until tomorrow |
| "The free data plan has hit its request limit" | Normal on free tiers if you refresh a lot | Wait a minute; it recovers on its own |
| Stock prices are not changing | Markets are closed | Prices resume when the exchange opens; crypto trades 24/7 |
| `command not found: npm` | Node.js is not installed, or the terminal was open before you installed it | Redo Step 1, then open a *new* terminal |
| Page will not load at localhost:3000 | The app is not running | Run `npm run dev` again and look for errors in the terminal |

To check what the app can currently see, open
**<http://localhost:3000/api/health>** — it lists which data sources are configured.
It never shows the keys themselves.

---

## For developers

```bash
npm run dev        # development server
npm run build      # production build
npm start          # run the production build
npm run typecheck  # TypeScript, strict mode
npm test           # unit tests (vitest)
```

**Stack:** Next.js 15 (App Router), React 19, TypeScript (strict, with
`noUncheckedIndexedAccess`), Tailwind CSS 3. No database, no auth, no state store —
Phase 1 needs none of them.

### Layout

```
src/
  app/                     pages and API routes
    page.tsx               dashboard (server-rendered, then live)
    search/                search results
    asset/[kind]/[symbol]/ detail page
    api/                   quotes, quote, chart, search, health
  components/              client components: tables, chart, theme, search box
  lib/
    providers/             one adapter per vendor + the routing registry
    env.ts                 config; every key optional
    http.ts                timeout, retry, rate limit, circuit breaker
    cache.ts               TTL cache keyed by how fast each datum changes
    dto.ts                 wire shapes shared by API routes and components
```

### The two rules the code enforces

1. **Ask for a capability, never a vendor.** `market.quote(symbol, kind)` routes
   through `lib/providers/registry.ts`, which picks among configured providers by
   priority and falls through on failure. Swapping a data source is a change to that
   file's provider list or to a `BB_PRIORITY_*` env var — never to a page or a
   component.
2. **Absence is a value, not a gap.** Every provider returns
   `{ ok: true, data }` or `{ ok: false, reason }`, so the compiler forces each call
   site to handle "we do not have this". That is what makes the no-invented-data
   promise mechanical rather than a matter of discipline.

### Rate limits worth knowing

| Provider | Free limit | Used for |
| --- | --- | --- |
| CoinGecko | ~10–30 requests/min | crypto prices, coin statistics, crypto search |
| Binance | very high | crypto price history |
| Finnhub | 60 requests/min | stock prices, company data, stock search |
| Alpha Vantage | **25 requests/day** | stock price history only |

The dashboard polls every 30 seconds and pauses entirely while its browser tab is in
the background, which keeps a normal session inside every one of these.

---

## Phase 2

The AI analysis engine — scoring, factor breakdowns, buy/hold/sell views — is
intentionally absent. It will be added on top of this data layer once it has been
running against live providers. An earlier draft of a scoring engine exists in this
repository's git history at commit `b85a3d9` if it is useful as a starting point.

---

Market data is for research and information only. Nothing here is investment advice.
