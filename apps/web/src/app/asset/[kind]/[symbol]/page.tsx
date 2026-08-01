import { notFound } from 'next/navigation';
import { detail, getPlan, getScore } from '@/lib/service';
import { market } from '@/lib/providers/registry';
import { findAsset } from '@/lib/universe';
import { RiskPanel } from '@/components/risk-panel';
import { AssetHeader } from '@/components/detail/asset-header';
import { AiAnalysis } from '@/components/detail/ai-analysis';
import { DecisionPanel, DecisionUnavailable } from '@/components/detail/decision-panel';
import { WhyPanel } from '@/components/detail/why-panel';
import { NewsSummaryPanel } from '@/components/detail/news-summary';
import { buildNewsSummary } from '@/lib/analysis/news-summary';
import {
  Card,
  SectionTitle,
  Unavailable,
  Delta,
  Provenance,
  formatPrice,
} from '@/components/primitives';
import type { AssetRef } from '@/lib/providers/types';
import { TradingViewChart } from '@/components/charts/tradingview';
import {
  BalanceSheetTable,
  CashFlowTable,
  IncomeStatementTable,
  InsiderTable,
  OwnershipTable,
  PriceTargetPanel,
} from '@/components/detail/financials';

// Live market data: rendered per request against the provider cache layer in
// lib/cache.ts. Static prerendering would bake quotes into the build output and
// spend provider quota at build time.
export const dynamic = 'force-dynamic';

export default async function AssetPage({
  params,
}: {
  params: Promise<{ kind: string; symbol: string }>;
}) {
  const { kind: kindParam, symbol: symbolParam } = await params;

  if (kindParam !== 'equity' && kindParam !== 'crypto') notFound();
  const kind = kindParam;
  const symbol = decodeURIComponent(symbolParam).toUpperCase();

  const known = findAsset(symbol, kind);
  const ref: AssetRef = known ?? {
    symbol,
    kind,
    market: kind === 'crypto' ? 'CRYPTO' : 'NASDAQ',
  };

  // Score, plan, profile and news are independent; fetch concurrently. `getPlan`
  // internally awaits the same cached score, so this costs a cache read rather
  // than a second scoring pass.
  const [outcome, plan, profile, news] = await Promise.all([
    getScore(ref),
    getPlan(ref),
    kind === 'equity' ? market.profile(symbol) : Promise.resolve(null),
    market.news(symbol, 8),
  ]);

  // Asset-class-specific panels. Every one of these is provider-gated, and each
  // returns a ProviderResult rather than throwing — so an unconfigured or
  // premium-only endpoint renders as a stated reason instead of removing the
  // section, which would leave a reader assuming the data does not exist.
  const [income, balance, cashflow, priceTarget, insiders, ownership, filings] =
    kind === 'equity'
      ? await Promise.all([
          detail.incomeStatement(symbol, 5),
          detail.balanceSheet(symbol, 5),
          detail.cashFlow(symbol, 5),
          detail.priceTarget(symbol),
          detail.insiderTransactions(symbol),
          detail.institutionalOwnership(symbol),
          market.filings(symbol, 8),
        ])
      : [null, null, null, null, null, null, null];

  const [cryptoMetrics, tvl] =
    kind === 'crypto'
      ? await Promise.all([market.cryptoMetrics(symbol), detail.chainTvl(symbol)])
      : [null, null];

  const quote = outcome.ok ? outcome.quote : undefined;
  const name = known?.name ?? (profile?.ok ? profile.data.name : symbol);

  return (
    <div className="space-y-8 animate-fade-up">
      {/*
        The decision, always visible and above everything else: name, live price,
        recommendation, confidence, AI score, last updated. A reader who came to
        decide should not have to scroll or expand anything to do it.
      */}
      {outcome.ok ? (
        <AssetHeader
          name={name}
          symbol={symbol}
          market={ref.market}
          score={outcome.score}
          {...(quote ? { quote } : {})}
        />
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight">{symbol}</h1>
                <span className="rounded-md border border-glass-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
                  {ref.market}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{name}</p>
            </div>
            {quote ? (
              <div className="text-right">
                <div className="tnum text-3xl font-semibold">{formatPrice(quote.price)}</div>
                <div className="mt-1 flex items-center justify-end gap-3">
                  <Delta value={quote.changePercent} />
                  <Provenance source={quote.source} asOf={quote.asOf} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-faint">Price unavailable</p>
            )}
          </div>

          <Unavailable
            title="No recommendation could be produced"
            reason={outcome.message}
            hint="A score is withheld rather than estimated when coverage is insufficient."
          />
          {outcome.omitted && outcome.omitted.length > 0 ? (
            <Card className="divide-y divide-glass-border/50">
              {outcome.omitted.map((o) => (
                <div key={o.factor} className="p-4">
                  <p className="text-sm font-medium capitalize text-ink-muted">{o.factor}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">{o.reason}</p>
                </div>
              ))}
            </Card>
          ) : null}
        </section>
      )}

      {/*
        The decision itself: what to do, at what price, where to take profit,
        where to exit if wrong. Always visible, directly under the header — these
        are the numbers a reader came for, and putting them behind a disclosure
        would leave the page answering "how good is this asset" instead of "what
        do I do about it".
      */}
      {plan.ok ? (
        <DecisionPanel plan={plan.plan} />
      ) : (
        <DecisionUnavailable message={plan.message} missing={plan.missing} />
      )}

      {/*
        Everything explaining the decision is collapsed behind one click. The
        breakdown has not been removed or thinned — it is the same six-factor
        explanation with the same citations, regrouped under the four headings a
        reader actually asks about, and no longer the first thing between them
        and their decision.
      */}
      {outcome.ok ? (
        <AiAnalysis
          factorCount={outcome.score.breakdown.length}
          omittedCount={outcome.score.omitted.length}
          showLabel="Why is AI recommending this?"
          hideLabel="Hide explanation"
        >
          <WhyPanel score={outcome.score} {...(plan.ok ? { plan: plan.plan } : {})} />
          <RiskPanel risk={outcome.score.risk} />

          <section>
            <SectionTitle hint="derived from classified headlines, not generated prose">
              Market summary
            </SectionTitle>
            <NewsSummaryPanel
              summary={buildNewsSummary(
                outcome.score.breakdown,
                news.ok ? news.data : [],
                outcome.score.omitted,
              )}
            />
          </section>

          {quote ? (
            <section>
              <SectionTitle>Session</SectionTitle>
              <Card className="grid grid-cols-2 gap-px overflow-hidden bg-glass-border/40 sm:grid-cols-4">
                <Stat label="Open" value={quote.open} />
                <Stat label="High" value={quote.high} />
                <Stat label="Low" value={quote.low} />
                <Stat label="Prev close" value={quote.previousClose} />
              </Card>
            </section>
          ) : null}
        </AiAnalysis>
      ) : null}

      {/* Profile */}
      {profile?.ok ? (
        <section>
          <SectionTitle>Company profile</SectionTitle>
          <Card className="p-5">
            <dl className="grid gap-4 sm:grid-cols-3">
              {profile.data.industry ? (
                <Field label="Industry" value={profile.data.industry} />
              ) : null}
              {profile.data.country ? <Field label="Country" value={profile.data.country} /> : null}
              {profile.data.exchange ? (
                <Field label="Exchange" value={profile.data.exchange} />
              ) : null}
            </dl>
            {profile.data.website ? (
              <a
                href={profile.data.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block text-xs text-gold hover:text-gold-soft"
              >
                {profile.data.website} ↗
              </a>
            ) : null}
            <div className="mt-4 border-t border-glass-border/60 pt-3">
              <Provenance source={profile.data.source} asOf={profile.data.asOf} />
            </div>
          </Card>
        </section>
      ) : null}

      {/* Chart */}
      <section>
        <SectionTitle hint="independent third-party source">Price chart</SectionTitle>
        <TradingViewChart symbol={symbol} market={ref.market} kind={kind} />
      </section>

      {kind === 'equity' ? (
        <>
          <section>
            <SectionTitle hint="last 5 reported years">Income statement</SectionTitle>
            <Card className="p-5">
              {income?.ok ? (
                <IncomeStatementTable statements={income.data} />
              ) : (
                <Unavailable
                  title="No income statement"
                  reason={income?.detail ?? income?.reason.replace(/_/g, ' ') ?? 'unavailable'}
                  hint="Set FMP_API_KEY to enable financial statements."
                />
              )}
            </Card>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <SectionTitle>Balance sheet</SectionTitle>
              <Card className="p-5">
                {balance?.ok ? (
                  <BalanceSheetTable statements={balance.data} />
                ) : (
                  <Unavailable
                    title="No balance sheet"
                    reason={balance?.detail ?? balance?.reason.replace(/_/g, ' ') ?? 'unavailable'}
                  />
                )}
              </Card>
            </section>

            <section>
              <SectionTitle>Cash flow</SectionTitle>
              <Card className="p-5">
                {cashflow?.ok ? (
                  <CashFlowTable statements={cashflow.data} />
                ) : (
                  <Unavailable
                    title="No cash flow statement"
                    reason={
                      cashflow?.detail ?? cashflow?.reason.replace(/_/g, ' ') ?? 'unavailable'
                    }
                  />
                )}
              </Card>
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <section>
              <SectionTitle hint="sell-side">Price targets</SectionTitle>
              <Card className="p-5">
                {priceTarget?.ok ? (
                  <PriceTargetPanel
                    target={priceTarget.data}
                    {...(quote ? { currentPrice: quote.price } : {})}
                  />
                ) : (
                  <Unavailable
                    title="No analyst targets"
                    reason={
                      priceTarget?.detail ?? priceTarget?.reason.replace(/_/g, ' ') ?? 'unavailable'
                    }
                  />
                )}
              </Card>
            </section>

            <section>
              <SectionTitle hint="Form 4 filings">Insider trades</SectionTitle>
              <Card className="p-5">
                {insiders?.ok ? (
                  <InsiderTable rows={insiders.data.slice(0, 8)} />
                ) : (
                  <Unavailable
                    title="No insider filings"
                    reason={
                      insiders?.detail ?? insiders?.reason.replace(/_/g, ' ') ?? 'unavailable'
                    }
                  />
                )}
              </Card>
            </section>

            <section>
              <SectionTitle hint="13F filings">Institutional ownership</SectionTitle>
              <Card className="p-5">
                {ownership?.ok ? (
                  <OwnershipTable rows={ownership.data.slice(0, 8)} />
                ) : (
                  <Unavailable
                    title="No ownership data"
                    reason={
                      ownership?.detail ?? ownership?.reason.replace(/_/g, ' ') ?? 'unavailable'
                    }
                  />
                )}
              </Card>
            </section>
          </div>

          {/*
            SEC filings: links to the primary record, not a summary of it. A
            generated précis of a 10-K would be an interpretation presented with
            the authority of a legal document, which is the one thing this
            section must never be.
          */}
          <section>
            <SectionTitle hint="primary source documents, direct from EDGAR">
              SEC filings
            </SectionTitle>
            {filings?.ok ? (
              <Card className="divide-y divide-glass-border/50">
                {filings.data.map((f) => (
                  <a
                    key={f.id}
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-baseline gap-4 p-4 transition-colors hover:bg-glass"
                  >
                    <span className="w-20 shrink-0 rounded border border-glass-border px-1.5 py-0.5 text-center text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                      {f.form}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        {f.description ?? f.filer}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-faint">
                        Filed {f.filedAt.toISOString().slice(0, 10)}
                        {f.periodOfReport
                          ? ` · period ending ${f.periodOfReport.toISOString().slice(0, 10)}`
                          : ''}
                      </span>
                    </span>
                    <Provenance source={f.source} />
                  </a>
                ))}
              </Card>
            ) : (
              <Card className="p-5">
                <Unavailable
                  title="No SEC filings"
                  reason={filings?.detail ?? filings?.reason.replace(/_/g, ' ') ?? 'unavailable'}
                  hint="EDGAR needs no API key, but it does require SEC_USER_AGENT to name a contact."
                />
              </Card>
            )}
          </section>
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <SectionTitle hint="supply and market">On-chain &amp; market metrics</SectionTitle>
            <Card className="p-5">
              {cryptoMetrics?.ok ? (
                <dl className="space-y-3 text-sm">
                  {[
                    ['Market cap', cryptoMetrics.data.marketCap],
                    ['24h volume', cryptoMetrics.data.volume24h],
                    ['Circulating supply', cryptoMetrics.data.circulatingSupply],
                    ['Total supply', cryptoMetrics.data.totalSupply],
                    ['Max supply', cryptoMetrics.data.maxSupply],
                    ['Rank', cryptoMetrics.data.rank],
                    ['GitHub commits (4w)', cryptoMetrics.data.githubCommits4w],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex justify-between gap-4">
                      <dt className="text-ink-muted">{label}</dt>
                      <dd className="tnum text-ink">
                        {/* An absent metric shows an em dash. A zero max supply
                            and an unreported one are different facts — one means
                            uncapped, the other means unknown. */}
                        {typeof value === 'number' && Number.isFinite(value)
                          ? value.toLocaleString('en-US')
                          : '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <Unavailable
                  title="No crypto metrics"
                  reason={
                    cryptoMetrics?.detail ??
                    cryptoMetrics?.reason.replace(/_/g, ' ') ??
                    'unavailable'
                  }
                />
              )}
              {cryptoMetrics?.ok ? (
                <div className="mt-4 border-t border-glass-border/60 pt-3">
                  <Provenance source={cryptoMetrics.data.source} asOf={cryptoMetrics.data.asOf} />
                </div>
              ) : null}
            </Card>
          </section>

          <section>
            <SectionTitle hint="DeFi protocols on this chain">Total value locked</SectionTitle>
            <Card className="p-5">
              {tvl?.ok ? (
                <div className="space-y-3">
                  <p className="tnum text-3xl font-semibold text-ink">
                    ${(tvl.data.tvl / 1e9).toFixed(2)}B
                  </p>
                  {tvl.data.change7d !== undefined ? (
                    <p
                      className={`tnum text-sm ${tvl.data.change7d >= 0 ? 'text-bull' : 'text-bear'}`}
                    >
                      {tvl.data.change7d >= 0 ? '+' : ''}
                      {(tvl.data.change7d * 100).toFixed(1)}% over 7 days
                    </p>
                  ) : null}
                  <p className="text-xs leading-relaxed text-ink-faint">
                    TVL moves with token prices as much as with adoption — a chain whose token
                    halves shows TVL halving with no user leaving. It is not a valuation.
                  </p>
                  <Provenance source={tvl.data.source} asOf={tvl.data.asOf} />
                </div>
              ) : (
                <Unavailable
                  title="No TVL"
                  reason={tvl?.detail ?? tvl?.reason.replace(/_/g, ' ') ?? 'unavailable'}
                />
              )}
            </Card>
          </section>
        </div>
      )}

      {/*
        The scrolling news feed is gone. It has been replaced by the market
        summary inside the AI analysis — which is derived from the classifier's
        measurements rather than written about the headlines — and by these
        links, so every claim in that summary can be checked against its source.
        A feed of twenty headlines is reading material; this is evidence.
      */}
      {!outcome.ok && news.ok && news.data.length > 0 ? (
        <section>
          <SectionTitle hint="no score was produced, so the headlines are shown unclassified">
            Recent headlines
          </SectionTitle>
          <Card className="divide-y divide-glass-border/50">
            {news.data.slice(0, 6).map((a) => (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-4 transition-colors hover:bg-glass"
              >
                <p className="text-sm leading-snug text-ink">{a.headline}</p>
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-ink-faint">
                  <span>{a.outlet}</span>
                  <span>·</span>
                  <span>{a.publishedAt.toISOString().slice(0, 10)}</span>
                  <Provenance source={a.source} />
                </div>
              </a>
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="bg-canvas-raised p-4">
      <dt className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="tnum mt-1 text-sm font-medium">
        {value === undefined ? <span className="text-ink-faint">—</span> : formatPrice(value)}
      </dd>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-1 text-sm text-ink-muted">{value}</dd>
    </div>
  );
}
