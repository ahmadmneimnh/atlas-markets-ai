import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type output } from 'zod';
import { isDatabaseConfigured } from '@atlas/db';

import { ForbiddenError, UnauthorizedError } from '@/lib/auth';
import { log } from '@/lib/logger';

/**
 * One error envelope for every route handler.
 *
 * `{ error, message, details }` — `error` is a stable machine-readable code the
 * client branches on, `message` is for humans and may be reworded freely,
 * `details` is structured or absent. Never a stringified stack trace: a stack in
 * a response body leaks file paths, dependency versions and sometimes the shape
 * of the query that failed.
 */
export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export function apiError(
  status: number,
  error: string,
  message: string,
  details?: unknown,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error, message, ...(details === undefined ? {} : { details }) },
    { status },
  );
}

/**
 * Maps a thrown error to a response.
 *
 * Known error types get their specific status. Anything else becomes a 500 with
 * a generic message, and the real error goes to the log — an unexpected error's
 * message frequently contains a connection string or a fragment of a query.
 */
export function handleApiError(error: unknown, route: string): NextResponse<ApiError> {
  if (error instanceof UnauthorizedError) {
    return apiError(401, 'unauthorized', 'Sign in to continue.');
  }

  if (error instanceof ForbiddenError) {
    return apiError(403, 'forbidden', 'Your account does not have access to this.', {
      permission: error.permission,
    });
  }

  if (error instanceof ZodError) {
    return apiError(400, 'invalid_request', 'The request body or parameters were invalid.', {
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  log.error('api_unhandled', { route, error });
  return apiError(500, 'internal_error', 'Something went wrong. The failure has been logged.');
}

/**
 * Guard for every route that touches persistence.
 *
 * Atlas runs without a database — market data and scoring do not need one — so a
 * user-data route has to answer something coherent rather than throwing a Prisma
 * connection error. 503 with the reason is the honest answer: the capability
 * exists, this deployment has not enabled it.
 */
export function requireDatabase(): NextResponse<ApiError> | null {
  if (isDatabaseConfigured) return null;
  return apiError(
    503,
    'database_not_configured',
    'This deployment has no database, so saved watchlists, portfolios and alerts are unavailable. ' +
      'Set DATABASE_URL and run `npm run db:push`.',
  );
}

/**
 * Parses and validates a JSON body, throwing ZodError for `handleApiError`.
 *
 * Typed as `output<S>` rather than a bare `T` inferred from `ZodSchema<T>`: with
 * `.default()` or `.transform()` a schema's input and output types differ, and
 * `ZodSchema<T>` forces them equal — which silently widens every defaulted field
 * back to `| undefined` at the call site.
 */
export async function parseBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    // A malformed body is the client's error, not ours, and must not surface as
    // a 500 alongside genuine server faults.
    throw new ZodError([{ code: 'custom', path: [], message: 'Request body is not valid JSON.' }]);
  }
  return schema.parse(raw);
}
