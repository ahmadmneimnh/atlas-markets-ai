import type { Role } from '@atlas/db';
import type { DefaultSession } from 'next-auth';

/**
 * Widens the session user with the fields the app actually branches on.
 *
 * Without this, `session.user.role` is a type error at every call site and the
 * usual workaround is a cast — which is how a permission check ends up reading a
 * field that does not exist at runtime.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession['user'];
  }

  interface User {
    role?: Role;
  }
}

export {};
