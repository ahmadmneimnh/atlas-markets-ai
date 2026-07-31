import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
});
