import { defineConfig, devices } from '@playwright/test';

// Stage 4 client-IP spoofing fix (WORKLOG.md this date) -- a SEPARATE, deliberately not-part-of-
// the-default-suite config. resolveTrustedClientIp() (lib/clientIp.ts) only takes its
// CF-Connecting-IP-trusted / X-Forwarded-For-ignored branch when NODE_ENV === 'production', which
// `next dev` (what playwright.config.ts's webServer runs) never sets -- so the actual production
// security property ("rotating X-Forwarded-For no longer bypasses a rate limit") cannot be
// exercised through the ordinary dev-server suite. Deterministic proof of the resolver's own
// logic already lives in lib/__tests__/clientIp.test.ts (unit-level, controls NODE_ENV directly);
// this config exists to additionally prove it end-to-end, through a real production build talking
// to real routes, run on demand (`npx playwright test -c playwright.prod-security.config.ts`)
// rather than on every default suite run -- a `next build` + `next start` cycle adds real minutes
// this project's existing dev-mode suite deliberately avoids paying on every invocation.
const PORT = 3101;
export const PROD_BASE_URL = `http://127.0.0.1:${PORT}`;

const LOCAL_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export default defineConfig({
  testDir: './e2e',
  testMatch: /client-ip-security\.prod\.spec\.ts/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: PROD_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build then start in production mode -- NODE_ENV=production is set by `next start` itself,
    // exercising the exact branch of resolveTrustedClientIp() that only applies in real
    // deployments. NEXT_PUBLIC_SUPABASE_URL must point at local Supabase at BUILD time (Next.js
    // inlines NEXT_PUBLIC_* values into both client and server bundles during `next build`), so
    // these env vars are set for the whole command, not just `next start`.
    command: `npx next build && npx next start -p ${PORT}`,
    url: PROD_BASE_URL,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NODE_ENV: 'production',
      NEXT_PUBLIC_DEMO_MODE: '',
      ALLOW_DEMO_MODE: '',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: LOCAL_SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_APP_URL: PROD_BASE_URL,
    },
  },
});
