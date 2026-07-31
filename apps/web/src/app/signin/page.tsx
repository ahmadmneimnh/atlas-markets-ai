import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card, Unavailable } from '@/components/primitives';
import { currentUser, isAuthConfigured, providerStatuses, signIn } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  OAuthAccountNotLinked:
    'That email is already registered with a different sign-in method. Use the one you signed up with.',
  AccessDenied: 'This account cannot sign in. If you believe that is a mistake, contact support.',
  Verification: 'That sign-in link has expired or was already used. Request a new one.',
  Configuration: 'Sign-in is misconfigured on the server. The server log has the detail.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;

  if (await currentUser()) redirect(callbackUrl ?? '/');

  const statuses = providerStatuses();
  const available = statuses.filter((p) => p.configured);
  const emailProvider = available.find((p) => p.id === 'nodemailer');
  const oauth = available.filter((p) => p.id !== 'nodemailer');

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-16">
      <Card className="p-8">
        <h1 className="gold-text text-2xl font-semibold tracking-tight">Sign in to Atlas</h1>
        <p className="mt-2 text-sm text-ink-muted">
          An account adds watchlists, portfolios and alerts. Market data and AI scores work without
          one.
        </p>

        {error ? (
          <p className="mt-6 rounded-lg border border-bear/30 bg-bear/10 px-4 py-3 text-sm text-bear">
            {ERRORS[error] ?? 'Sign-in failed. Please try again.'}
          </p>
        ) : null}

        {!isAuthConfigured ? (
          <div className="mt-6">
            {/* States the actual blocker rather than showing buttons that fail on
                click. Which requirement is missing is deliberately not shown to
                anonymous visitors — that is server configuration, and it belongs
                in the admin panel and the log. */}
            <Unavailable
              title="Sign-in unavailable"
              reason="No authentication provider is configured on this deployment."
              hint="See docs/AUTHENTICATION.md for the setup steps."
            />
            <Link href="/" className="mt-6 inline-block text-sm text-gold hover:underline">
              ← Back to the dashboard
            </Link>
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            {oauth.length > 0 ? (
              <div className="space-y-3">
                {oauth.map((provider) => (
                  <form
                    key={provider.id}
                    action={async () => {
                      'use server';
                      await signIn(provider.id, { redirectTo: callbackUrl ?? '/' });
                    }}
                  >
                    <button
                      type="submit"
                      className="glass glass-hover w-full rounded-xl px-4 py-3 text-sm font-medium text-ink transition"
                    >
                      Continue with {provider.label}
                    </button>
                  </form>
                ))}
              </div>
            ) : null}

            {oauth.length > 0 && emailProvider ? (
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-glass-border" />
                <span className="text-xs uppercase tracking-widest text-ink-faint">or</span>
                <span className="h-px flex-1 bg-glass-border" />
              </div>
            ) : null}

            {emailProvider ? (
              <form
                action={async (formData: FormData) => {
                  'use server';
                  await signIn('nodemailer', {
                    email: String(formData.get('email') ?? ''),
                    redirectTo: callbackUrl ?? '/',
                  });
                }}
                className="space-y-3"
              >
                <label
                  htmlFor="email"
                  className="block text-xs uppercase tracking-widest text-ink-faint"
                >
                  Email a sign-in link
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-glass-border bg-canvas-raised px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-gold/40 focus:outline-none"
                />
                <button
                  type="submit"
                  className="w-full rounded-xl bg-gold px-4 py-3 text-sm font-semibold text-canvas transition hover:bg-gold-soft"
                >
                  Send link
                </button>
              </form>
            ) : null}
          </div>
        )}
      </Card>

      <p className="mt-6 text-center text-xs text-ink-faint">
        Atlas provides algorithmic analysis of public data. Not investment advice.
      </p>
    </main>
  );
}

export function generateMetadata() {
  return { title: 'Sign in · Atlas Markets AI' };
}
