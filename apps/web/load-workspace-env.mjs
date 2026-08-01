import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Loads the repository-root `.env` into `process.env`.
 *
 * Next resolves `.env` against its own project directory, which in this
 * workspace is `apps/web` — so a `.env` at the repository root is simply never
 * read. That failure is silent and it does not look like a configuration
 * problem: with no credentials loaded, `isConfigured()` returns false for every
 * keyed vendor, the registry's candidate list collapses to the unauthenticated
 * fallbacks, and the app serves quotes from Yahoo until it rate-limits. What
 * reaches the logs is `provider:"yahoo" reason:"rate_limited"` and `coverage: 0`,
 * which reads as a provider outage rather than a file nobody opened.
 *
 * The other workspaces already point at the root file explicitly
 * (`dotenv -e ../../.env` in @atlas/db and @atlas/worker). This is the web app's
 * equivalent. It is called from `next.config.mjs` rather than from an npm script
 * because Next evaluates that config for `dev`, `build` and `start` alike —
 * patching one script would leave the other entry points, and the standalone
 * server the Docker image runs, still blind to it.
 *
 * Precedence, in decreasing order:
 *   1. real environment variables
 *   2. `apps/web/.env` (Next has already merged it by the time this runs)
 *   3. the repository-root `.env`
 *
 * `override` is therefore off. Nothing here may shadow a value a platform
 * actually set, which is the behaviour that matters on Vercel, Railway and in
 * Docker — none of which have a `.env` at all, and all of which pass every value
 * through the real environment.
 *
 * Extracted from the config so the precedence rules above are testable against a
 * temporary directory rather than against whatever happens to be on the
 * developer's disk.
 *
 * @param {string} rootDir Directory holding the `.env` to load.
 * @param {{ log?: (message: string) => void, warn?: (message: string) => void }} [io]
 * @returns {{ loaded: string[], skipped: string[], reason?: string }}
 *   `loaded` are keys taken from the file; `skipped` are keys the file defined
 *   but that were already set and therefore left alone.
 */
export function loadWorkspaceEnv(rootDir, io = {}) {
  const { log = () => {}, warn = () => {} } = io;
  const envPath = path.join(rootDir, '.env');

  if (!fs.existsSync(envPath)) {
    return { loaded: [], skipped: [], reason: 'no .env at the workspace root' };
  }

  try {
    const require = createRequire(import.meta.url);
    // Resolved rather than imported statically: a deployment that prunes to
    // production dependencies must not fail to boot over a file it never uses.
    const dotenv = require('dotenv');

    // Parsed first so the caller can be told which keys an existing environment
    // took precedence over. `dotenv.config` alone cannot distinguish "applied"
    // from "already set and ignored", and that distinction is the whole answer
    // when someone asks why their .env edit had no effect.
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    const loaded = [];
    const skipped = [];

    for (const [key, value] of Object.entries(parsed)) {
      if (Object.prototype.hasOwnProperty.call(process.env, key)) {
        skipped.push(key);
        continue;
      }
      process.env[key] = value;
      loaded.push(key);
    }

    if (loaded.length > 0) log(`   - Environments: ${envPath} (workspace root)`);
    return { loaded, skipped };
  } catch (error) {
    // A malformed or unreadable root .env earns a loud warning and nothing more.
    // Refusing to start would take down a deployment that reads its
    // configuration from the real environment and never needed this file.
    const reason = error instanceof Error ? error.message : String(error);
    warn(`   - Warning: could not read ${envPath}: ${reason}`);
    return { loaded: [], skipped: [], reason };
  }
}
