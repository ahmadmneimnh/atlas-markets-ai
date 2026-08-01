import Link from 'next/link';
import type { Metadata } from 'next';
import { market } from '@/lib/providers/registry';
import { toUnavailableDTO } from '@/lib/dto';
import { Badge, Card, InsufficientData, SectionTitle } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: "Search — Batal's Brain" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = (await searchParams).q?.trim() ?? '';

  if (query.length === 0) {
    return (
      <div className="animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Search</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Type a ticker or company name — AAPL, Tesla, BTC, Solana — into the box at the top of
          the page.
        </p>
      </div>
    );
  }

  const result = await market.search(query);
  const hits = result.ok ? result.data : [];
  const crypto = hits.filter((h) => h.kind === 'crypto');
  const stocks = hits.filter((h) => h.kind === 'equity');

  return (
    <div className="animate-fade-up space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Results for <span className="text-accent">{query}</span>
        </h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          {hits.length} {hits.length === 1 ? 'match' : 'matches'} across stocks and cryptocurrency.
        </p>
      </section>

      {hits.length === 0 ? (
        <Card className="p-0">
          <InsufficientData
            what={`Search for "${query}"`}
            unavailable={toUnavailableDTO(result)}
            hint="Stock search needs FINNHUB_API_KEY. Crypto search works without any key."
          />
        </Card>
      ) : (
        <>
          {stocks.length > 0 ? (
            <section>
              <SectionTitle hint={`${stocks.length} found`}>Stocks</SectionTitle>
              <ResultList hits={stocks} />
            </section>
          ) : null}

          {crypto.length > 0 ? (
            <section>
              <SectionTitle hint={`${crypto.length} found`}>Cryptocurrency</SectionTitle>
              <ResultList hits={crypto} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ResultList({
  hits,
}: {
  hits: { symbol: string; name: string; kind: 'equity' | 'crypto'; source: string }[];
}) {
  return (
    <Card className="overflow-hidden p-0">
      <ul className="divide-y divide-line">
        {hits.slice(0, 30).map((hit, i) => (
          <li key={`${hit.kind}-${hit.symbol}-${i}`}>
            <Link
              href={`/asset/${hit.kind}/${encodeURIComponent(hit.symbol)}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-canvas"
            >
              <span className="w-20 shrink-0 truncate text-sm font-semibold text-ink">{hit.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">{hit.name}</span>
              <Badge>{hit.kind === 'crypto' ? 'Crypto' : 'Stock'}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
