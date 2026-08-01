import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { analyseAsset } from '@/lib/analysis/engine';
import { AnalysisCard, AnalysisUnavailableCard } from '@/components/analysis/analysis-card';
import { RecommendationCard } from '@/components/analysis/recommendation-card';
import { ExplanationCard } from '@/components/analysis/explanation-card';
import { RiskCard } from '@/components/analysis/risk-card';
import { market } from '@/lib/providers/registry';
import { findAsset } from '@/lib/universe';
import { toQuoteDTO, toUnavailableDTO } from '@/lib/dto';
import { formatCompact, formatNumber, formatPercent } from '@/lib/format';
import { Badge, Card, InsufficientData, Provenance, SectionTitle, Stat } from '@/components/ui';
import { LiveQuote } from '@/components/live-quote';
import { PriceChart } from '@/components/price-chart';
import type { AssetKind } from '@/lib/providers/types';

export const dynamic = 'force-dynamic';

/** Crypto trades continuously; a stock quote only moves during its session. */
const REFRESH_MS = { crypto: 15_000, equity: 30_000 } as const;

function parse(kind: string, symbol: string): { kind: AssetKind; symbol: string } | null {
  if (kind !== 'equity' && kind !== 'crypto') return null;
  const upper = decodeURIComponent(symbol).trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,15}$/.test(upper)) return null;
  return { kind, symbol: upper };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string; symbol: string }>;
}): Promise<Metadata> {
  const { kind, symbol } = await params;
  const parsed = parse(kind, symbol);
  return { title: parsed ? `${parsed.symbol} — Batal's Brain` : "Batal's Brain" };
}

export default async function AssetPage({
  params,
}: {
  params: Promise<{ kind: string; symbol: string }>;
}) {
  const raw = await params;
  const parsed = parse(raw.kind, raw.symbol);
  if (!parsed) notFound();

  const { kind, symbol } = parsed;
  const known = findAsset(symbol, kind);

  // Independent lookups, so fetch them together rather than in sequence.
  const [quote, profile, fundamentals, metrics] = await Promise.all([
    market.quote(symbol, kind),
    kind === 'equity' ? market.profile(symbol) : Promise.resolve(null),
    kind === 'equity' ? market.fundamentals(symbol) : Promise.resolve(null),
    kind === 'crypto' ? market.cryptoMetrics(symbol) : Promise.resolve(null),
  ]);

  const name = known?.name ?? (profile?.ok ? profile.data.name : symbol);
  // Only stocks have a listing venue worth showing; for crypto it would repeat the
  // "Crypto" badge sitting next to it.
  const venue =
    kind === 'equity' ? (known?.market ?? (profile?.ok ? profile.data.exchange : undefined)) : undefined;

  return (
    <div className="animate-fade-up space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{symbol}</h1>
            <Badge>{kind === 'crypto' ? 'Crypto' : 'Stock'}</Badge>
            {venue ? <Badge>{venue}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-ink-muted">{name}</p>
          {profile?.ok && profile.data.industry ? (
            <p className="mt-0.5 text-xs text-ink-faint">{profile.data.industry}</p>
          ) : null}
        </div>

        {profile?.ok && profile.data.website ? (
          <a
            href={profile.data.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent hover:underline"
          >
            Company website ↗
          </a>
        ) : null}
      </section>

      <Card className="p-5">
        <LiveQuote
          symbol={symbol}
          kind={kind}
          refreshMs={REFRESH_MS[kind]}
          initial={{
            quote: quote.ok ? toQuoteDTO(quote.data) : null,
            unavailable: toUnavailableDTO(quote),
          }}
        />
      </Card>

      {/* Streamed in: the engine makes several provider calls, and the price, chart
          and statistics above must not wait on them. */}
      <Suspense fallback={<AnalysisSkeleton />}>
        <AnalysisSection symbol={symbol} kind={kind} name={name} />
      </Suspense>

      <Card className="p-5">
        <PriceChart symbol={symbol} kind={kind} />
      </Card>

      <section>
        <SectionTitle hint={kind === 'crypto' ? 'from CoinGecko' : 'from the fundamentals provider'}>
          Key statistics
        </SectionTitle>

        {kind === 'crypto' ? (
          metrics?.ok ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Market cap" value={metrics.data.marketCap !== undefined ? `$${formatCompact(metrics.data.marketCap)}` : '—'} />
              <Stat label="Rank" value={metrics.data.rank !== undefined ? `#${metrics.data.rank}` : '—'} />
              <Stat label="24h volume" value={metrics.data.volume24h !== undefined ? `$${formatCompact(metrics.data.volume24h)}` : '—'} />
              <Stat label="Circulating" value={formatCompact(metrics.data.circulatingSupply)} />
              <Stat label="Total supply" value={formatCompact(metrics.data.totalSupply)} />
              <Stat label="Max supply" value={formatCompact(metrics.data.maxSupply)} />
            </div>
          ) : (
            <Card className="p-0">
              <InsufficientData what="Coin statistics" unavailable={toUnavailableDTO(metrics!)} />
            </Card>
          )
        ) : fundamentals?.ok ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Market cap" value={fundamentals.data.marketCap !== undefined ? `$${formatCompact(fundamentals.data.marketCap)}` : '—'} />
            <Stat label="P/E (TTM)" value={formatNumber(fundamentals.data.peRatio)} />
            <Stat label="EPS (TTM)" value={formatNumber(fundamentals.data.eps)} />
            <Stat label="Profit margin" value={formatPercent(fundamentals.data.profitMargin)} />
            <Stat label="Return on equity" value={formatPercent(fundamentals.data.roe)} />
            <Stat label="Dividend yield" value={formatPercent(fundamentals.data.dividendYield)} />
          </div>
        ) : (
          <Card className="p-0">
            <InsufficientData
              what="Company statistics"
              unavailable={toUnavailableDTO(fundamentals!)}
              hint="Company fundamentals come from Finnhub or Alpha Vantage."
            />
          </Card>
        )}

        {kind === 'crypto' && metrics?.ok ? (
          <p className="mt-2">
            <Provenance source={metrics.data.source} />
          </p>
        ) : null}
        {kind === 'equity' && fundamentals?.ok ? (
          <p className="mt-2">
            <Provenance source={fundamentals.data.source} />
          </p>
        ) : null}
      </section>
    </div>
  );
}

/**
 * The Phase 2 engine output. Rendered as its own async component so the page can
 * stream: everything above paints as soon as the quote resolves, and this section
 * fills in when the analysis completes.
 */
async function AnalysisSection({
  symbol,
  kind,
  name,
}: {
  symbol: string;
  kind: AssetKind;
  name: string;
}) {
  const analysis = await analyseAsset({ symbol, kind, name });

  if (!analysis.available) {
    return (
      <AnalysisUnavailableCard modules={analysis.modules} detail={analysis.unavailable.detail} />
    );
  }

  return (
    <div className="space-y-8">
      <RecommendationCard rec={analysis} />
      <ExplanationCard rec={analysis} />
      <AnalysisCard rec={analysis} />
      <RiskCard rec={analysis} />
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <section>
      <SectionTitle>Recommendation</SectionTitle>
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-6">
          <div className="skeleton h-[132px] w-[132px] rounded-full" />
          <div className="min-w-[240px] flex-1 space-y-3">
            <div className="skeleton h-6 w-32" />
            <div className="skeleton h-3 w-full" />
            <div className="skeleton h-2.5 w-full rounded-full" />
          </div>
        </div>
        <p className="mt-4 text-xs text-ink-faint">Running the analysis modules…</p>
      </Card>
    </section>
  );
}
