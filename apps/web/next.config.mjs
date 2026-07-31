import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Repository root, two levels up from apps/web.
const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Emits .next/standalone, which the Docker runner stage copies. Without this
  // the image builds but has no server.js to start.
  output: 'standalone',

  // In a workspace, npm hoists dependencies to the repository root. Without this
  // the file tracer walks up from apps/web, guesses the wrong root, and emits a
  // standalone bundle missing every hoisted package.
  outputFileTracingRoot: workspaceRoot,

  // Workspace packages ship TypeScript source rather than a build artifact —
  // one fewer build step, and stack traces point at real files.
  transpilePackages: ['@atlas/core', '@atlas/db'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
