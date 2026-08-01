# Batal's Brain

A live market dashboard for cryptocurrency and stocks. Prices, search, asset pages
and interactive charts — all from real market data providers, refreshed
automatically.

**Phase 1 (market data) and Phase 2 (the analysis engine) are both in.** The engine
does not predict prices: it measures what the data says, weighs the evidence, and
shows every number behind the verdict.

---

## What it does

### Phase 1 — market data

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

### Phase 2 — analysis engine

| Feature | Where | Built from |
| --- | --- | --- |
| Buy / Hold / Sell recommendation | Asset page | weighted score across four modules |
| Conviction score, 0–100 | Asset page | the same weighted score |
| Buy / Hold / Sell percentages | Asset page | module votes, damped by confidence; always total 100 |
| Confidence rating | Asset page | data coverage, input completeness, module agreement |
| Entry zone, stop loss, target | Asset page | ATR(14) and 120-day pivot levels |
| Investment horizon | Asset page | volatility, trend strength, fundamentals |
| Risk classification | Asset page | volatility, drawdown, ATR, market cap |
| Evidence: reasons and warnings | Asset page | every line is a measured value from a module |
| Market scanner | `/scanner` | the same engine across every tracked asset |

The four modules and their nominal weights: **Technical 40%**, **Fundamentals 30%**,
**Market conditions 20%**, **News sentiment 10%**. A module that cannot get its data
does not vote — its weight is redistributed to the modules that did report, and the
confidence rating falls. If less than half the weighting is available, no verdict is
issued at all.

**One rule this app follows everywhere:** it never makes a number up. If a data
source is missing, rate-limited or down, you see **"Insufficient Data"** and a plain
explanation of why — never a zero, a placeholder or an estimate. That applies to the
analysis too: an unmeasurable risk is not "Low Risk", and news that was never read is
not "neutral sentiment".

> Recommendations are algorithmic readings of public market data for research and
> information. They are not investment advice, and the suggested levels are
> arithmetic on measured volatility — not forecasts.

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
neither phase needs them.

### Layout

```
src/
  app/                     pages and API routes
    page.tsx               dashboard (server-rendered, then live)
    search/                search results
    scanner/               engine run across every tracked asset
    asset/[kind]/[symbol]/ detail page + streamed analysis
    api/                   quotes, quote, chart, search, analysis, scanner, health
  components/
    analysis/              recommendation, analysis, risk and explanation cards
    ...                    client components: tables, chart, theme, search box
  lib/
    providers/             one adapter per vendor + the routing registry
    analysis/              the Phase 2 engine, one file per concern:
      indicators.ts          pure maths: RSI, MACD, EMA/SMA, Bollinger, ATR, ADX…
      technical.ts           technical module
      fundamental.ts         stock and crypto fundamentals modules
      market.ts              market regime, breadth and sector strength
      sentiment.ts           news sentiment over real headlines
      risk.ts                risk classification
      levels.ts              entry / stop / target from ATR and pivots
      scoring.ts             weighting, conviction, probabilities, confidence
      engine.ts              orchestration only — fetches, runs modules, scores
      scanner.ts             the whole universe through the engine
    env.ts                 config; every key optional
    http.ts                timeout, retry, rate limit, circuit breaker
    cache.ts               TTL cache keyed by how fast each datum changes
    dto.ts                 wire shapes shared by API routes and components
```

Every analysis module is a pure function of its inputs — `engine.ts` is the only file
that does I/O — so each module is testable and reusable on its own.

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
| Alpha Vantage | **25 requests/day** | stock price history, stock technicals, market benchmark |

The dashboard polls every 30 seconds and pauses entirely while its browser tab is in
the background, which keeps a normal session inside every one of these.

**Alpha Vantage is the tight one.** Stock charts, the technical module for stocks and
the `SPY` market benchmark all draw on the same 25 requests a day. Daily bars are
cached for six hours and the market benchmark for 30 minutes, so ordinary browsing
is fine — but a full scanner run touches every tracked stock. If stock technicals
start reporting "the free data plan has hit its request limit", that is the cause;
crypto is unaffected because Binance and CoinGecko serve it.

### Analysis caching

| Value | Cached for | Why |
| --- | --- | --- |
| Market context (regime, breadth, sectors) | 30 minutes | shared by every asset page and the scanner |
| Per-asset analysis | 5 minutes | the technicals move with the price |
| Scanner run | 5 minutes | one run serves everyone hitting `/scanner` |

---

## What the engine still cannot see

The analysis is only as good as the data behind it, and several inputs that would
materially improve it are not available on the free tiers this app is built for.
Every one of them shows as **Insufficient Data** rather than being estimated.

The short version, best value first:

1. **Earnings calendar** — the engine cannot tell that a company reports tomorrow.
   Finnhub's free tier includes it; this is the cheapest real improvement available.
2. **A stock history provider without a 25/day ceiling** (Twelve Data, Polygon, FMP)
   — removes the one constraint that can silence the technical module for stocks,
   and brings intraday bars with it.
3. **A crypto news source** (CryptoPanic, NewsAPI) — sentiment is stock-only today,
   so 10% of the weighting is redistributed on every crypto asset.
4. **Sector ETF quotes** — sector strength is currently measured from the handful of
   tracked stocks in each sector, which is a small sample, not a sector.
5. **Macro series** (FRED: rates, CPI, dollar index) — market conditions currently
   mean "how is this asset class trading", with no macro context at all.

Also missing entirely: insider and institutional flow, short interest, options
positioning, and crypto on-chain metrics. The full reasoning, and what each gap
costs in accuracy, is in **[docs/DATA-GAPS.md](docs/DATA-GAPS.md)**.

---

Market data is for research and information only. Nothing here is investment advice.
Recommendations are algorithmic readings of public data, and the suggested levels are
arithmetic on measured volatility — not forecasts.
