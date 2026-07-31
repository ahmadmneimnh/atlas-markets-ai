#!/usr/bin/env node
/**
 * Mints an Apple "Sign in with Apple" client secret.
 *
 * Apple is the only provider whose client secret is not a string you copy from a
 * console: it is an ES256 JWT signed with a .p8 private key, and Apple rejects
 * any token with a lifetime over six months. The practical consequence is that
 * Apple sign-in breaks on a schedule unless someone re-mints it — so this exists
 * as a script rather than as a paragraph of instructions nobody will follow.
 *
 * Usage:
 *   APPLE_TEAM_ID=... APPLE_CLIENT_ID=... APPLE_KEY_ID=... \
 *   APPLE_PRIVATE_KEY_PATH=./AuthKey_XXXXXXXXXX.p8 \
 *   npm run auth:apple-secret
 *
 * Uses only node:crypto — no dependency, because a script that signs a private
 * key should have as small a supply chain as possible.
 */
import { createSign, createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

const required = ['APPLE_TEAM_ID', 'APPLE_CLIENT_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY_PATH'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing: ${missing.join(', ')}\n`);
  console.error('Set them in .env or inline. See docs/AUTHENTICATION.md.');
  process.exit(1);
}

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

const now = Math.floor(Date.now() / 1000);
const SIX_MONTHS = 15777000; // Apple's hard maximum, in seconds.

const header = { alg: 'ES256', kid: process.env.APPLE_KEY_ID };
const payload = {
  iss: process.env.APPLE_TEAM_ID,
  iat: now,
  exp: now + SIX_MONTHS,
  aud: 'https://appleid.apple.com',
  sub: process.env.APPLE_CLIENT_ID,
};

const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

const privateKey = createPrivateKey(readFileSync(process.env.APPLE_PRIVATE_KEY_PATH, 'utf8'));
const signer = createSign('SHA256');
signer.update(signingInput);
signer.end();

// dsaEncoding matters: Apple expects the raw r||s pair (IEEE P1363), and Node's
// default DER encoding produces a token Apple rejects with an opaque error.
const signature = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });

const token = `${signingInput}.${signature
  .toString('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')}`;

console.log('\nAPPLE_CLIENT_SECRET=' + token);
console.error(
  `\nExpires ${new Date((now + SIX_MONTHS) * 1000).toISOString()} — re-run before then.`,
);
