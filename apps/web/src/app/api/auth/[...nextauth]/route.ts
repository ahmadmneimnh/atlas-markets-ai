import { NextResponse, type NextRequest } from 'next/server';

import { handlers, isAuthConfigured } from '@/lib/auth';

/**
 * Auth.js catch-all. Handles /api/auth/signin, /callback/{provider}, /session,
 * /csrf and /signout.
 *
 * `force-dynamic` because every one of those reads cookies; a statically
 * optimised auth route would serve one user's session to the next.
 */
export const dynamic = 'force-dynamic';

/**
 * With no AUTH_SECRET and no providers, Auth.js throws — and `/api/auth/session`
 * is polled by every client that mounts a session provider, so an unconfigured
 * deployment would emit a 500 on a timer.
 *
 * `/session` therefore answers `null`, which is the honest response: there is no
 * session. Everything else answers 503 with the reason, because a sign-in attempt
 * against an unconfigured server has genuinely failed and should say so rather
 * than hang.
 */
function unconfigured(request: NextRequest): NextResponse | null {
  if (isAuthConfigured) return null;

  if (new URL(request.url).pathname.endsWith('/session')) {
    return NextResponse.json(null, { status: 200 });
  }

  return NextResponse.json(
    {
      error: 'auth_not_configured',
      message:
        'Authentication is not configured on this deployment. It requires AUTH_SECRET, a ' +
        'DATABASE_URL, and at least one sign-in provider.',
    },
    { status: 503 },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  return unconfigured(request) ?? handlers.GET(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return unconfigured(request) ?? handlers.POST(request);
}
