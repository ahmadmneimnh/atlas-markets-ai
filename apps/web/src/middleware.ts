import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route protection.
 *
 * This runs on the Edge runtime, where Prisma cannot run — so it deliberately
 * does **not** resolve the session. It checks only for the presence of a session
 * cookie and redirects when there is none.
 *
 * That is a routing convenience, not an authorisation check. A forged cookie
 * gets past it. Every protected page and route handler still calls
 * `requireUser()` / `requirePermission()`, which does verify. Treating this as
 * the security boundary is the classic Next.js middleware mistake: it moves
 * authorisation to the one place in the stack that cannot reach the database.
 */
const PROTECTED = [/^\/portfolio/, /^\/watchlist/, /^\/alerts/, /^\/settings/, /^\/admin/];

// Auth.js names the cookie `__Secure-authjs.session-token` over HTTPS and
// `authjs.session-token` otherwise. Both are checked because local development
// is HTTP and production is not.
const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (!PROTECTED.some((pattern) => pattern.test(pathname))) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const signInUrl = new URL('/signin', request.url);
  signInUrl.searchParams.set('callbackUrl', `${pathname}${search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  // Excludes API routes, static assets and the auth endpoints themselves —
  // redirecting /api/auth/callback to /signin would break the OAuth handshake.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
