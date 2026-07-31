import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

/**
 * ESLint 9 flat config. `eslint-config-next` is still distributed in the legacy
 * eslintrc format, so it is bridged through FlatCompat rather than rewritten —
 * a hand-maintained copy of Next's rule set would drift on the next release.
 */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },

  ...compat.extends('next/core-web-vitals'),

  {
    rules: {
      /**
       * The layering rule, enforced rather than documented.
       *
       * A component that can import a provider *adapter* is a component that
       * will eventually fetch during render — and adapters read API keys, so one
       * such import in a client component puts a credential in the browser
       * bundle. Data reaches components through `@/lib/service`.
       *
       * Scoped to the adapter directories on purpose. `@/lib/providers/types` is
       * type-only and erased at compile time, and `@/lib/providers/registry`
       * exposes which capabilities are configured — the admin and search pages
       * legitimately render that. Banning those too would make the rule
       * something people switch off rather than something they obey.
       */
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/lib/providers/equity/*',
                '@/lib/providers/crypto/*',
                '@/lib/providers/http',
              ],
              message:
                'Provider adapters read API keys and must stay server-side. Go through @/lib/service.',
            },
          ],
        },
      ],
    },
  },

  {
    // The service layer, the API routes and the tests are the legitimate callers.
    files: ['src/lib/**/*.ts', 'src/app/api/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

export default config;
