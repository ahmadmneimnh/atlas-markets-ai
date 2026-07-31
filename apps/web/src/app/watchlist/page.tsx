import { Card, Unavailable } from '@/components/primitives';

export default function Page() {
  return (
    <div className="space-y-6 animate-fade-up">
      <h1 className="text-2xl font-semibold tracking-tight capitalize">watchlist</h1>
      <Unavailable
        title="Requires authentication and a database"
        reason="The watchlist feature is modelled in prisma/schema.prisma but is not wired up in this build. Enabling it needs a provisioned PostgreSQL instance (DATABASE_URL) and an auth provider. See docs/ROADMAP.md, phase 7."
        hint="docker compose up -d postgres && npm run db:push"
      />
      <Card className="p-5">
        <p className="text-xs leading-relaxed text-ink-muted">
          The schema is deliberately lot-based rather than storing a single averaged cost basis: tax
          treatment and holding-period rules need per-purchase dates, and averaging at write time
          destroys that information irrecoverably.
        </p>
      </Card>
    </div>
  );
}
