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
  // Dev-only (Next.js ignores this outside `next dev`) -- Playwright (playwright.config.ts,
  // Stage 6) navigates to 127.0.0.1 explicitly, which Next's default dev-origin allowlist
  // (localhost only) blocks the HMR websocket for. Found live this session: without this, the
  // blocked/repeatedly-retrying HMR handshake measurably delayed client hydration, which was
  // masking a real bug as a flaky one (a form's onSubmit handler not yet attached when a test
  // clicked submit, falling through to a native GET form submission instead).
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: [
    '@propvault/config',
    '@propvault/types',
    '@propvault/ui',
    '@propvault/utils',
    '@propvault/validation',
  ],
  // pdfkit reads its .afm font files at runtime via a path relative to its own __dirname
  // (lib/invoicePdf.ts). Turbopack's bundler rewrites __dirname for bundled CJS modules and does
  // not copy pdfkit's non-JS data assets, breaking that lookup (observed: ENOENT resolving to a
  // synthetic "C:\ROOT\..." path instead of the real node_modules location). Excluding it from
  // bundling makes Next.js load it via native require() at runtime instead, where __dirname
  // resolves correctly. Found live this session testing /api/v1/invoices/[id]/pdf.
  serverExternalPackages: ['pdfkit'],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
