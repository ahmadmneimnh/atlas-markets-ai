import { scoreMany } from '@/lib/service';
import { market, marketWide } from '@/lib/providers/registry';
import { CRYPTO_UNIVERSE, UNIVERSE } from '@/lib/universe';
import { configuredProviders } from '@/lib/env';
import { AssetScoreCard } from '@/components/score-card';
import {
  Card,
  SectionTitle,
  Unavailable,
  Delta,
  formatPrice,
  Provenance,
} from '@/components/primitives';
import type { AssetScore } from '@/lib/analysis/types';
import type { Quote } from '@/lib/providers/types';
import { Heatmap } from '@/components/dashboard/heatmap';
import { FearGreedGauge } from '@/components/dashboard/fear-greed';
import { EarningsList, EconomicList, NewsList } from '@/components/dashboard/calendars';
import { TrendingList, volumeRatioOf, type TrendingItem } from '@/components/dashboard/trending';

// Live market data: rendered per request against the provider cache layer in
// lib/cache.ts. Static prerendering would bake quotes into the build output and
// spend provider quota at build time.
export const dynamic = 'force-dynamic';

interface Scored {
  name: string;
  score: AssetScore;
  quote?: Quote;
}

export default async function DashboardPage() {
  const providers = configuredProviders();
  const hasEquityProvider = providers['finnhub'] || providers['twelvedata'] || providers['polygon'];

  // Crypto works with no credentials at all (CoinGecko public + Binance public), so
  // the dashboard is useful on a fresh clone. Equities need a key.
  const refs = hasEquityProvider ? UNIVERSE : CRYPTO_UNIVERSE;
  const results = await scoreMany(refs, 4);

  // Market-wide panels fetched in parallel with each other, after scoring rather
  // than alongside it: the scorer already saturates the provider rate limiters,
  // and racing these against it would just convert them into 429s. Each is
  // independent, so `allSettled` semantics come free from the ProviderResult
  // union — one unconfigured vendor never blanks the others.
  const today = new Date();
  const isoDay = (offsetDays: number) =>
    new Date(today.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  const [fearGreed, earnings, economic, headlines] = await Promise.all([
    marketWide.fearGreed(),
    marketWide.earnings(isoDay(0), isoDay(7)),
    marketWide.economicCalendar(isoDay(0), isoDay(7)),
    market.news(null, 8),
  ]);

  const scored: Scored[] = results
    .filter((r) => r.result.ok)
    .map((r) => {
      const res = r.result as { ok: true; score: AssetScore; quote?: Quote };
      const entry = UNIVERSE.find((u) => u.symbol === r.ref.symbol && u.kind === r.ref.kind);
      const item: Scored = { name: entry?.name ?? r.ref.symbol, score: res.score };
      if (res.quote) item.quote = res.quote;
      return item;
    });

  const failed = results.filter((r) => !r.result.ok);

  const byScore = [...scored].sort((a, b) => b.score.score - a.score.score);

  // Trending = unusual activity, measured as today's volume against the asset's
  // own 20-bar average. Assets whose volume signal is missing are excluded, not
  // ranked at zero: an unmeasured ratio is not a low one.
  const trending: TrendingItem[] = scored
    .flatMap((s) => {
      const measured = volumeRatioOf(s.score);
      if (!measured) return [];
      const item: TrendingItem = {
        name: s.name,
        score: s.score,
        volumeRatio: measured.ratio,
        source: measured.source,
      };
      if (s.quote) item.quote = s.quote;
      return [item];
    })
    .sort((a, b) => b.volumeRatio - a.volumeRatio);

  const trendingEquities = trending.filter((t) => t.score.ref.kind === 'equity').slice(0, 5);
  const trendingCrypto = trending.filter((t) => t.score.ref.kind === 'crypto').slice(0, 5);

  const topBuys = byScore.filter((s) => s.score.score >= 56).slice(0, 4);
  const topSells = [...byScore]
    .reverse()
    .filter((s) => s.score.score <= 45)
    .slice(0, 4);

  const movers = [...scored]
    .filter((s) => s.quote)
    .sort((a, b) => Math.abs(b.quote!.changePercent) - Math.abs(a.quote!.changePercent));
  const gainers = movers.filter((s) => s.quote!.changePercent > 0).slice(0, 5);
  const losers = movers
    .filter((s) => s.quote!.changePercent < 0)
    .reverse()
    .slice(0, 5);

  return (
    <div className="space-y-10 animate-fade-up">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">
          Global market <span className="gold-text">intelligence</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          {scored.length} assets scored from live provider data. Every figure below is attributed to
          its source; factors without data are excluded from scoring rather than estimated.
        </p>
      </section>

      {!hasEquityProvider ? (
        <Card className="border-gold/20 bg-gold-glow/40 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-gold">◆</span>
            <div>
              <p className="text-sm font-medium text-ink">Equity coverage is off</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                No equity data provider is configured, so only crypto is scored — crypto providers
                (CoinGecko, Binance) work without credentials. Set{' '}
                <code className="rounded bg-canvas-sunken px-1.5 py-0.5 font-mono text-[11px] text-gold-soft">
                  FINNHUB_API_KEY
                </code>{' '}
                to enable NYSE/NASDAQ and the rest.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Market-wide panels. Rendered outside the "any asset scored" branch on
          purpose: Fear & Greed, the calendars and the headline feed depend on
          neither the tracked universe nor the scoring engine. Nesting them
          inside it meant a total scoring failure silently removed four panels
          that were perfectly capable of answering. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section>
          <SectionTitle hint="crypto index">Fear &amp; Greed</SectionTitle>
          <Card className="p-5">
            {fearGreed.ok ? (
              <FearGreedGauge reading={fearGreed.data} />
            ) : (
              <Unavailable
                title="Index unavailable"
                reason={fearGreed.detail ?? fearGreed.reason.replace(/_/g, ' ')}
              />
            )}
          </Card>
        </section>

        <section>
          <SectionTitle hint="next 7 days">Upcoming earnings</SectionTitle>
          <Card>
            {earnings.ok ? (
              <EarningsList events={earnings.data.slice(0, 8)} />
            ) : (
              <div className="p-5">
                <Unavailable
                  title="No earnings calendar"
                  reason={earnings.detail ?? earnings.reason.replace(/_/g, ' ')}
                  hint="Set FINNHUB_API_KEY to enable this panel."
                />
              </div>
            )}
          </Card>
        </section>

        <section>
          <SectionTitle hint="next 7 days">Economic events</SectionTitle>
          <Card>
            {economic.ok ? (
              <EconomicList events={economic.data.slice(0, 8)} />
            ) : (
              <div className="p-5">
                <Unavailable
                  title="No economic calendar"
                  reason={economic.detail ?? economic.reason.replace(/_/g, ' ')}
                />
              </div>
            )}
          </Card>
        </section>
      </div>

      <section>
        <SectionTitle hint="market-wide">Latest news</SectionTitle>
        <Card>
          {headlines.ok ? (
            <NewsList articles={headlines.data.slice(0, 8)} />
          ) : (
            <div className="p-5">
              <Unavailable
                title="No headlines"
                reason={headlines.detail ?? headlines.reason.replace(/_/g, ' ')}
                hint="Set FINNHUB_API_KEY or FMP_API_KEY to enable this panel."
              />
            </div>
          )}
        </Card>
      </section>

      {scored.length === 0 ? (
        <Unavailable
          title="No assets could be scored"
          reason={
            failed[0] && !failed[0].result.ok
              ? `Every provider call failed. First error: ${failed[0].result.message}`
              : 'No data provider returned usable data.'
          }
          hint="cp .env.example .env  →  add at least one API key"
        />
      ) : (
        <>
          <section>
            <SectionTitle hint={`${topBuys.length} of ${scored.length} scored assets`}>
              Top AI buys today
            </SectionTitle>
            {topBuys.length === 0 ? (
              <Card className="p-6">
                <p className="text-sm text-ink-muted">
                  No asset in the tracked universe currently scores in the Buy range (56+).
                </p>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {topBuys.map((s) => (
                  <AssetScoreCard key={`${s.score.ref.kind}-${s.score.ref.symbol}`} {...s} />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle hint="scored 45 or below">Top AI sells today</SectionTitle>
            {topSells.length === 0 ? (
              <Card className="p-6">
                <p className="text-sm text-ink-muted">
                  No asset in the tracked universe currently scores in the Sell range.
                </p>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {topSells.map((s) => (
                  <AssetScoreCard key={`${s.score.ref.kind}-${s.score.ref.symbol}`} {...s} />
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <SectionTitle>Biggest gainers (24h)</SectionTitle>
              <Card className="divide-y divide-glass-border/50">
                {gainers.length === 0 ? (
                  <p className="p-5 text-sm text-ink-faint">
                    No positive movers in the tracked universe.
                  </p>
                ) : (
                  gainers.map((s) => <MoverRow key={s.score.ref.symbol} item={s} />)
                )}
              </Card>
            </section>

            <section>
              <SectionTitle>Biggest losers (24h)</SectionTitle>
              <Card className="divide-y divide-glass-border/50">
                {losers.length === 0 ? (
                  <p className="p-5 text-sm text-ink-faint">
                    No negative movers in the tracked universe.
                  </p>
                ) : (
                  losers.map((s) => <MoverRow key={s.score.ref.symbol} item={s} />)
                )}
              </Card>
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <SectionTitle hint="by volume vs 20-bar average">Trending stocks</SectionTitle>
              <Card>
                <TrendingList items={trendingEquities} />
              </Card>
            </section>

            <section>
              <SectionTitle hint="by volume vs 20-bar average">Trending crypto</SectionTitle>
              <Card>
                <TrendingList items={trendingCrypto} />
              </Card>
            </section>
          </div>

          <section>
            <SectionTitle hint="colour by 24h move, size by relative magnitude">
              Market heatmap
            </SectionTitle>
            <Card className="p-4">
              <Heatmap items={scored} />
            </Card>
          </section>

          <section>
            <SectionTitle hint="full tracked universe">All scored assets</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {byScore.map((s) => (
                <AssetScoreCard key={`${s.score.ref.kind}-${s.score.ref.symbol}`} {...s} />
              ))}
            </div>
          </section>
        </>
      )}

      {failed.length > 0 ? (
        <section>
          <SectionTitle hint="reported, not hidden">Assets that could not be scored</SectionTitle>
          <Card className="divide-y divide-glass-border/50">
            {failed.map((f) => (
              <div key={`${f.ref.kind}-${f.ref.symbol}`} className="flex items-start gap-3 p-4">
                <span className="w-16 shrink-0 text-sm font-medium">{f.ref.symbol}</span>
                <p className="text-xs leading-relaxed text-ink-faint">
                  {!f.result.ok ? f.result.message : ''}
                </p>
              </div>
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function MoverRow({ item }: { item: Scored }) {
  const q = item.quote;
  if (!q) return null;
  return (
    <a
      href={`/asset/${item.score.ref.kind}/${item.score.ref.symbol}`}
      className="flex items-center gap-4 p-4 transition-colors hover:bg-glass"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{item.score.ref.symbol}</span>
          <span className="truncate text-xs text-ink-faint">{item.name}</span>
        </div>
        <div className="mt-0.5">
          <Provenance source={q.source} asOf={q.asOf} />
        </div>
      </div>
      <span className="tnum text-sm">${formatPrice(q.price)}</span>
      <Delta value={q.changePercent} />
    </a>
  );
}
