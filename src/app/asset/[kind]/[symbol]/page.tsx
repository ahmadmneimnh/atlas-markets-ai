import { notFound } from 'next/navigation';
import { getScore } from '@/lib/service';
import { market } from '@/lib/providers/registry';
import { findAsset } from '@/lib/universe';
import { ScoreExplanation } from '@/components/score-card';
import {
  Card, SectionTitle, Unavailable, Delta, Provenance, formatPrice,
} from '@/components/ui';
import type { AssetRef } from '@/lib/providers/types';

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

  // Score, profile and news are independent; fetch concurrently.
  const [outcome, profile, news] = await Promise.all([
    getScore(ref),
    kind === 'equity' ? market.profile(symbol) : Promise.resolve(null),
    market.news(symbol, 8),
  ]);

  const quote = outcome.ok ? outcome.quote : undefined;
  const name = known?.name ?? (profile?.ok ? profile.data.name : symbol);

  return (
    <div className="space-y-8 animate-fade-up">
      {/* Header */}
      <section className="flex flex-wrap items-start justify-between gap-6">
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
            <div className="tnum text-3xl font-semibold">
              {quote.currency === 'USD' || quote.currency === 'USDT' ? '$' : ''}
              {formatPrice(quote.price)}
            </div>
            <div className="mt-1 flex items-center justify-end gap-3">
              <Delta value={quote.changePercent} />
              <Provenance source={quote.source} asOf={quote.asOf} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-faint">Price unavailable</p>
        )}
      </section>

      {/* Quote detail */}
      {quote ? (
        <Card className="grid grid-cols-2 gap-px overflow-hidden bg-glass-border/40 sm:grid-cols-4">
          <Stat label="Open" value={quote.open} />
          <Stat label="High" value={quote.high} />
          <Stat label="Low" value={quote.low} />
          <Stat label="Prev close" value={quote.previousClose} />
        </Card>
      ) : null}

      {/* Recommendation */}
      <section>
        <SectionTitle hint="every figure attributed to its provider">AI recommendation</SectionTitle>
        {outcome.ok ? (
          <ScoreExplanation score={outcome.score} />
        ) : (
          <div className="space-y-4">
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
          </div>
        )}
      </section>

      {/* Profile */}
      {profile?.ok ? (
        <section>
          <SectionTitle>Company profile</SectionTitle>
          <Card className="p-5">
            <dl className="grid gap-4 sm:grid-cols-3">
              {profile.data.industry ? <Field label="Industry" value={profile.data.industry} /> : null}
              {profile.data.country ? <Field label="Country" value={profile.data.country} /> : null}
              {profile.data.exchange ? <Field label="Exchange" value={profile.data.exchange} /> : null}
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

      {/* News */}
      <section>
        <SectionTitle hint="classified by the news factor">Latest news</SectionTitle>
        {news.ok && news.data.length > 0 ? (
          <Card className="divide-y divide-glass-border/50">
            {news.data.map((a) => (
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
        ) : (
          <Unavailable
            title="No news available"
            reason={
              news.ok
                ? 'The provider returned no articles for this asset in the last 14 days.'
                : `Provider unavailable: ${news.reason}${news.detail ? ` — ${news.detail}` : ''}`
            }
          />
        )}
      </section>
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
