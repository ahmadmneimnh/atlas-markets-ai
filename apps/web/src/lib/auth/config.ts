import 'server-only';

import { PrismaAdapter } from '@auth/prisma-adapter';
import type { NextAuthConfig } from 'next-auth';
import { isDatabaseConfigured, prisma } from '@atlas/db';

import { buildProviders } from './providers';

/**
 * Auth.js configuration.
 *
 * Authentication is **optional infrastructure** here. Atlas browses and scores
 * without an account, so an unconfigured auth layer must not break the app — it
 * must report that signing in is unavailable and let everything else work. That
 * is why `isAuthConfigured` exists and why the adapter is only attached when a
 * database is present.
 */

const providers = buildProviders();

/**
 * Auth is usable only with all three: somewhere to store sessions, at least one
 * way to sign in, and a secret to sign cookies with.
 */
export const isAuthConfigured =
  isDatabaseConfigured && providers.length > 0 && Boolean(process.env.AUTH_SECRET);

export const authConfig: NextAuthConfig = {
  // Attached only when a database exists. The adapter's first act is a query, so
  // wiring it without one turns every page load into a connection error.
  adapter: isDatabaseConfigured ? PrismaAdapter(prisma) : undefined,

  providers,

  // Database sessions rather than JWT. A JWT cannot be revoked before it expires,
  // so banning a user or dropping their role would not take effect until their
  // token aged out. With a database session, both are immediate — worth one
  // indexed lookup per request.
  session: {
    strategy: isDatabaseConfigured ? 'database' : 'jwt',
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },

  pages: {
    signIn: '/signin',
    error: '/signin',
    verifyRequest: '/signin/check-email',
  },

  callbacks: {
    /**
     * Runs before a session is created. Returning false aborts sign-in.
     */
    async signIn({ user }) {
      if (!isDatabaseConfigured) return true;
      if (!user.email) return false; // No address means no account recovery and no alerts.

      const existing = await prisma.user.findUnique({
        where: { email: user.email },
        select: { bannedAt: true },
      });

      return !existing?.bannedAt;
    },

    /**
     * Puts role and permissions on the session so components and route handlers
     * do not each re-query the user row.
     */
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
        session.user.role = (user as { role?: 'USER' | 'PRO' | 'ADMIN' }).role ?? 'USER';
      }
      return session;
    },

    /**
     * Keeps redirects on our own origin. Without this check, a crafted
     * `callbackUrl` turns the sign-in flow into an open redirect — a phishing
     * primitive that borrows this site's credibility.
     */
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {
        // Unparseable callback: fall through to the safe default.
      }
      return baseUrl;
    },
  },

  events: {
    async signIn({ user }) {
      if (!isDatabaseConfigured || !user.id) return;
      await prisma.user
        .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
        .catch(() => {
          // Best-effort telemetry. Failing sign-in because a timestamp write
          // failed would be a worse outcome than a missing timestamp.
        });
    },
  },

  // Cookies are host-only and lax by default in Auth.js, which is correct here.
  // `trustHost` is required behind a proxy (Vercel, Railway, an ALB) where the
  // Host header is rewritten.
  trustHost: true,

  debug: false,
};
