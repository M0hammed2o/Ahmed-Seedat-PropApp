import path from 'node:path';
import type { NextConfig } from 'next';

// Secure headers on the admin dashboard (SECURITY.md release-blocking requirement). CSP is
// intentionally restrictive; loosen only for a specific, documented asset host once chosen.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://*.supabase.co;",
  },
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
