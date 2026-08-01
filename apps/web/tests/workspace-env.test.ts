import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// @ts-expect-error — plain ESM helper, loaded by next.config.mjs; no .d.ts.
import { loadWorkspaceEnv } from '../load-workspace-env.mjs';

/**
 * Guards the workspace `.env` loading that `next.config.mjs` depends on.
 *
 * The bug this exists to prevent has a nasty shape: Next resolves `.env` against
 * `apps/web`, so a repository-root `.env` was never read, every keyed provider
 * reported itself unconfigured, and the registry quietly fell back to the
 * unauthenticated vendors. Nothing crashed. The app served Yahoo quotes until
 * they rate-limited and reported `coverage: 0`, which looks exactly like a
 * provider outage — so the failure could survive a restart, a rebuild and a
 * careful reading of `env.ts`, all of which were correct.
 */

const created: string[] = [];
const touchedKeys: string[] = [];

function tempRoot(contents?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-env-'));
  created.push(dir);
  if (contents !== undefined) fs.writeFileSync(path.join(dir, '.env'), contents);
  return dir;
}

function track(...keys: string[]): void {
  touchedKeys.push(...keys);
}

afterEach(() => {
  for (const key of touchedKeys.splice(0)) delete process.env[key];
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadWorkspaceEnv', () => {
  it('reads a root .env into process.env', () => {
    track('ATLAS_TEST_KEY');
    const root = tempRoot('ATLAS_TEST_KEY=from-root-file\n');

    const result = loadWorkspaceEnv(root);

    expect(result.loaded).toContain('ATLAS_TEST_KEY');
    expect(process.env['ATLAS_TEST_KEY']).toBe('from-root-file');
  });

  it('never overrides a value the real environment already set', () => {
    track('ATLAS_TEST_KEY');
    process.env['ATLAS_TEST_KEY'] = 'from-platform';
    const root = tempRoot('ATLAS_TEST_KEY=from-root-file\n');

    const result = loadWorkspaceEnv(root);

    // This is the property that makes the loader safe on Vercel, Railway and in
    // Docker, where configuration arrives through the real environment and a
    // stale committed .env must not be able to shadow it.
    expect(process.env['ATLAS_TEST_KEY']).toBe('from-platform');
    expect(result.skipped).toContain('ATLAS_TEST_KEY');
    expect(result.loaded).not.toContain('ATLAS_TEST_KEY');
  });

  it('reports skipped keys separately from loaded ones', () => {
    track('ATLAS_SET', 'ATLAS_UNSET');
    process.env['ATLAS_SET'] = 'already-here';
    const root = tempRoot('ATLAS_SET=ignored\nATLAS_UNSET=applied\n');

    const result = loadWorkspaceEnv(root);

    // "Applied" and "already set, so ignored" are different answers, and the
    // difference is the whole explanation when someone asks why editing .env
    // changed nothing.
    expect(result.loaded).toEqual(['ATLAS_UNSET']);
    expect(result.skipped).toEqual(['ATLAS_SET']);
  });

  it('parses quoted values without keeping the quotes', () => {
    track('ATLAS_QUOTED');
    // The shipped .env.example contains EMAIL_FROM="Atlas <no-reply@example.com>",
    // which a naive line splitter would load with the quotes attached.
    const root = tempRoot('ATLAS_QUOTED="Atlas Markets AI <no-reply@example.com>"\n');

    loadWorkspaceEnv(root);

    expect(process.env['ATLAS_QUOTED']).toBe('Atlas Markets AI <no-reply@example.com>');
  });

  it('ignores comments and blank lines', () => {
    track('ATLAS_REAL');
    const root = tempRoot('# a comment\n\nATLAS_REAL=yes\n# FINNHUB_API_KEY=commented-out\n');

    const result = loadWorkspaceEnv(root);

    expect(result.loaded).toEqual(['ATLAS_REAL']);
    expect(process.env['FINNHUB_API_KEY']).toBeUndefined();
  });

  it('is a no-op when no root .env exists, and says why', () => {
    const root = tempRoot();

    const result = loadWorkspaceEnv(root);

    // A missing root .env is normal in production. It must not throw, because
    // throwing here would take down a deployment that never needed the file.
    expect(result.loaded).toEqual([]);
    expect(result.reason).toContain('no .env');
  });

  it('does not throw when the root .env is unreadable', () => {
    const root = tempRoot('ATLAS_X=1\n');
    // A directory where a file is expected: readFileSync raises EISDIR.
    fs.rmSync(path.join(root, '.env'));
    fs.mkdirSync(path.join(root, '.env'));

    expect(() => loadWorkspaceEnv(root)).not.toThrow();
    expect(loadWorkspaceEnv(root).loaded).toEqual([]);
  });

  it('announces only when it actually applied something', () => {
    track('ATLAS_ANNOUNCE');
    const messages: string[] = [];

    loadWorkspaceEnv(tempRoot(), { log: (m: string) => messages.push(m) });
    expect(messages).toEqual([]);

    loadWorkspaceEnv(tempRoot('ATLAS_ANNOUNCE=1\n'), { log: (m: string) => messages.push(m) });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('workspace root');
  });
});

describe('workspace env wiring', () => {
  const repoRoot = path.join(__dirname, '..', '..', '..');

  it('has every workspace pointing at the one root .env', () => {
    // @atlas/db and @atlas/worker do it with `dotenv -e ../../.env` in their
    // scripts; the web app cannot, because Next owns its own entry points, so it
    // does it in next.config.mjs. If any of the three loses its mechanism, the
    // root .env silently stops reaching that workspace.
    const db = fs.readFileSync(path.join(repoRoot, 'packages/db/package.json'), 'utf8');
    const worker = fs.readFileSync(path.join(repoRoot, 'services/worker/package.json'), 'utf8');
    const nextConfig = fs.readFileSync(path.join(repoRoot, 'apps/web/next.config.mjs'), 'utf8');

    expect(db).toContain('dotenv -e ../../.env');
    expect(worker).toContain('dotenv -e ../../.env');
    expect(nextConfig).toContain('loadWorkspaceEnv');
  });

  it('loads the root env before next.config reads process.env', () => {
    const nextConfig = fs.readFileSync(path.join(repoRoot, 'apps/web/next.config.mjs'), 'utf8');

    // next.config itself reads AUTH_URL/NEXT_PUBLIC_SITE_URL to decide whether to
    // emit `upgrade-insecure-requests`. Loading the root .env after that read
    // would restore the CSP bug on any deployment that configures its origin
    // through the root file.
    expect(nextConfig.indexOf('loadWorkspaceEnv(workspaceRoot')).toBeLessThan(
      nextConfig.indexOf('const publicOrigin'),
    );
  });
});
