import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

// `server-only`'s export map exposes only ".", so the sibling file has to be
// reached through the resolved entrypoint's directory rather than a subpath.
const serverOnlyNoop = path.join(path.dirname(require.resolve('server-only')), 'empty.js');

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` ships a module that throws on import unless the bundler
      // resolves the "react-server" export condition. That guard is what keeps
      // provider adapters — and the API keys they read — out of any client
      // bundle, and it still applies to the real Next build. Under Vitest there
      // is no client bundle to protect, so it resolves to the no-op variant.
      //
      // Resolved through the module system rather than a hard-coded
      // `./node_modules/...` path: in the workspace layout npm hoists this
      // package to the repository root, so the literal path does not exist.
      'server-only': serverOnlyNoop,
    },
  },
});
