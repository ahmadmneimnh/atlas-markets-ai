import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Repository root, two levels up from apps/web.
const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Whether this deployment is actually served over HTTPS.
 *
 * This gates the CSP's `upgrade-insecure-requests` directive, and getting it
 * wrong is not cosmetic: that directive tells the browser to rewrite every
 * `http://` request to `https://`, including Next's own RSC prefetches. On a
 * plain-HTTP origin — which is what `npm run start` on localhost is, and what
 * the README tells people to run — every navigation then fails with
 * ERR_SSL_PROTOCOL_ERROR against a port that speaks no TLS.
 *
 * Inferred from the configured public origin rather than from NODE_ENV, because
 * a local production build is `NODE_ENV=production` over HTTP, and that is
 * exactly the case that breaks. HSTS already forces HTTPS for real deployments,
 * so nothing is lost by omitting this on an HTTP origin.
 */
const publicOrigin = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
const servedOverHttps = publicOrigin.startsWith('https://');

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
          // Disables browser features this app never uses. A compromised
          // dependency cannot then quietly ask for a camera or a location.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          // Two years, subdomains included. Only meaningful over HTTPS; harmless
          // on localhost, where browsers ignore it.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          {
            /**
             * CSP.
             *
             * `unsafe-inline` and `unsafe-eval` in script-src are required by the
             * TradingView widget, which injects inline configuration and is the
             * only third-party script here. That is a real weakening and it is
             * the price of the chart; dropping the widget would let this become
             * a nonce-based policy.
             *
             * `frame-src` is limited to TradingView's own origins, so the widget
             * cannot be swapped for an arbitrary frame by a script that gets in.
             */
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s3.tradingview.com https://*.tradingview.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.tradingview.com",
              'frame-src https://*.tradingview.com https://s.tradingview.com',
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              // Only meaningful, and only safe, on an HTTPS origin — see the
              // `servedOverHttps` note at the top of this file.
              ...(servedOverHttps ? ['upgrade-insecure-requests'] : []),
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
