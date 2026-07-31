import 'server-only';

import type { Provider } from 'next-auth/providers';
import Apple from 'next-auth/providers/apple';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import Nodemailer from 'next-auth/providers/nodemailer';

/**
 * Sign-in providers, assembled from whatever is actually configured.
 *
 * A provider whose credentials are absent is **omitted**, not registered with an
 * empty client id. Registering it anyway puts a "Sign in with Google" button on
 * the page that fails with an opaque OAuth error the moment anyone presses it —
 * the same failure mode as fabricating market data, one layer up: showing a
 * capability the system does not have.
 *
 * `configuredProviders()` reports what is available so the sign-in page can say
 * so plainly instead of rendering dead buttons.
 */

/** A placeholder left in `.env.example` is not a credential. */
function value(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  if (/^(your[-_]|<|changeme|xxx)/i.test(raw)) return undefined;
  return raw;
}

function pair(idVar: string, secretVar: string): { id: string; secret: string } | undefined {
  const id = value(idVar);
  const secret = value(secretVar);
  return id && secret ? { id, secret } : undefined;
}

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  /** What to set to turn it on. Shown in the admin panel, never to end users. */
  requires: string[];
}

export function providerStatuses(): ProviderStatus[] {
  return [
    {
      id: 'google',
      label: 'Google',
      configured: Boolean(pair('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')),
      requires: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    },
    {
      id: 'apple',
      label: 'Apple',
      configured: Boolean(pair('APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET')),
      requires: ['APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET'],
    },
    {
      id: 'github',
      label: 'GitHub',
      configured: Boolean(pair('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET')),
      requires: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    },
    {
      id: 'nodemailer',
      label: 'Email',
      configured: Boolean(value('EMAIL_SERVER_HOST') && value('EMAIL_FROM')),
      requires: ['EMAIL_SERVER_HOST', 'EMAIL_SERVER_USER', 'EMAIL_SERVER_PASSWORD', 'EMAIL_FROM'],
    },
  ];
}

export function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  const google = pair('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  if (google) {
    providers.push(
      Google({
        clientId: google.id,
        clientSecret: google.secret,
        // `consent` + `offline` is what actually returns a refresh token. Google
        // issues one only on first consent otherwise, so a re-authenticating user
        // silently loses offline access.
        authorization: {
          params: { prompt: 'consent', access_type: 'offline', response_type: 'code' },
        },
        allowDangerousEmailAccountLinking: false,
      }),
    );
  }

  const apple = pair('APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET');
  if (apple) {
    // APPLE_CLIENT_SECRET is not a static string: Apple requires a short-lived
    // ES256 JWT signed with the .p8 private key, valid for at most six months.
    // `npm run auth:apple-secret` mints one — see docs/AUTHENTICATION.md. It has
    // to be regenerated before expiry or sign-in breaks with no warning.
    providers.push(Apple({ clientId: apple.id, clientSecret: apple.secret }));
  }

  const github = pair('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET');
  if (github) {
    providers.push(Github(github.id, github.secret));
  }

  const emailHost = value('EMAIL_SERVER_HOST');
  const emailFrom = value('EMAIL_FROM');
  if (emailHost && emailFrom) {
    providers.push(
      Nodemailer({
        server: {
          host: emailHost,
          port: Number(value('EMAIL_SERVER_PORT') ?? 587),
          auth: {
            user: value('EMAIL_SERVER_USER') ?? '',
            pass: value('EMAIL_SERVER_PASSWORD') ?? '',
          },
        },
        from: emailFrom,
        // 15 minutes. The default 24h leaves a working sign-in link sitting in an
        // inbox for a day — long enough for a shared or breached mailbox to be a
        // full account takeover.
        maxAge: 15 * 60,
      }),
    );
  }

  return providers;
}

function Github(clientId: string, clientSecret: string): Provider {
  return GitHub({
    clientId,
    clientSecret,
    // GitHub only returns a verified primary email with this scope. Without it,
    // `email` can be null and the adapter creates an account with no address.
    authorization: { params: { scope: 'read:user user:email' } },
  });
}
