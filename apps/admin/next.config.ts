import path from 'node:path';
import type { NextConfig } from 'next';

// Secure headers on the admin dashboard (SECURITY.md release-blocking requirement).
// Content-Security-Policy is deliberately NOT set here: it needs a fresh nonce on every request
// (proxy.ts, 2026-08-02 fix) and a static value returned from headers() can't carry that --
// setting it both here and in proxy.ts would leave this stale, unenforced copy in place with no
// nonce, silently blocking every inline hydration script again.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root explicitly — otherwise Next.js walks upward looking for lockfiles
  // and can pick up an unrelated one from a parent directory outside this monorepo.
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
  transpilePackages: [
    '@propvault/config',
    '@propvault/types',
    '@propvault/ui',
    '@propvault/utils',
    '@propvault/validation',
  ],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
