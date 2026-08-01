import { providerStatus } from '@/lib/providers/registry';
import { SCORERS } from '@/lib/analysis/engine';
import { Card, SectionTitle, Unavailable } from '@/components/primitives';
import { isDatabaseConfigured } from '@atlas/db';
import { can, currentUser, isAuthConfigured } from '@/lib/auth';
import { AdminConsole } from '@/components/admin/console';

export const dynamic = 'force-dynamic';

/**
 * System health. Read-only in this build: it reports which providers hold
 * credentials and which scoring factors are live, which is the first question to
 * ask when a score looks thin.
 */
export default async function AdminPage() {
  /**
   * Two tiers on one page.
   *
   * `/admin` is in middleware's protected list, so reaching here at all requires
   * a session. The read-only system view below then shows any signed-in user
   * which providers are configured and what the factor weights are — never a key
   * value — because that is the first question to ask when a score looks thin.
   *
   * The write path is gated further, on the `admin:read` capability, and the
   * check is here on the server. A client-side check would hide the buttons
   * while leaving every /api/admin route wide open; those routes each call
   * `requirePermission` themselves for exactly that reason.
   */
  const user = isAuthConfigured ? await currentUser() : null;
  const isAdmin = can(user?.role, 'admin:read');

  const providers = providerStatus();
  const configured = providers.filter((p) => p.configured).length;

  return (
    <div className="space-y-8 animate-fade-up">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">System</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {configured} of {providers.length} data providers configured.
        </p>
      </section>

      <section>
        <SectionTitle hint="credentials are read server-side only">Data providers</SectionTitle>
        <Card className="divide-y divide-glass-border/50">
          {providers.map((p) => (
            <div key={p.id} className="flex items-center gap-4 p-4">
              <span
                className={
                  'inline-block h-2 w-2 shrink-0 rounded-full ' +
                  (p.configured ? 'bg-bull' : 'bg-ink-faint')
                }
                aria-label={p.configured ? 'configured' : 'not configured'}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{p.label}</p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                  {p.capabilities.join(' · ')}
                </p>
              </div>
              <span className={'text-xs ' + (p.configured ? 'text-bull' : 'text-ink-faint')}>
                {p.configured ? 'Active' : 'No credentials'}
              </span>
            </div>
          ))}
        </Card>
      </section>

      <section>
        <SectionTitle hint="nominal weights; renormalized per asset at scoring time">
          Scoring factors
        </SectionTitle>
        <Card className="divide-y divide-glass-border/50">
          {SCORERS.map((s) => (
            <div key={s.factor} className="flex items-center gap-4 p-4">
              <span className="w-28 text-sm font-medium capitalize">{s.factor}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-glass-strong">
                <div
                  className="h-full rounded-full bg-gold/60"
                  style={{ width: `${(s.weight / 30) * 100}%` }}
                />
              </div>
              <span className="tnum w-12 text-right text-sm text-ink-muted">{s.weight}%</span>
            </div>
          ))}
        </Card>
      </section>

      {/* Administrative write path — capability-gated on the server. */}
      {isAdmin ? (
        <AdminConsole />
      ) : (
        <section>
          <SectionTitle hint="requires an administrator account">Administration</SectionTitle>
          <Unavailable
            title={user ? 'Your account is not an administrator' : 'Sign in as an administrator'}
            reason={
              isDatabaseConfigured
                ? 'User management, feature flags, queues and the audit log require the admin role.'
                : 'This deployment has no database, so there are no accounts to administer.'
            }
          />
        </section>
      )}
    </div>
  );
}
