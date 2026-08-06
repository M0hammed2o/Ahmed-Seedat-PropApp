import { defineConfig, devices } from '@playwright/test';

// Stage 6 (commercial-launch execution plan, WORKLOG.md this date) -- TESTING.md §7's own
// stated intent: "verifying org A can never read org B's data is exercised through the full
// stack (API + UI), not just the database layer." Runs against a REAL Next.js dev server backed
// by the REAL local Supabase instance (`supabase start`, the same one every pgTAP test in this
// repo depends on) -- never demo mode, which fakes data client-side and would prove nothing about
// real RLS/API behaviour. TESTING.md §7 describes a "seeded multi-org staging environment"; no
// staging environment exists yet (blocked on the Stage 8 hosting decision), so this uses local
// Supabase as the closest available real backend instead -- disclosed substitution, not silently
// treated as equivalent to a real staging pass.
const PORT = 3100;
// Exported for reuse by tests that need to construct headers referencing the app's own origin
// directly (e.g. e2e/auth-security.spec.ts's rate-limit test, which uses Playwright's raw
// APIRequestContext -- unlike a real browser fetch(), it doesn't attach an Origin header
// automatically, so a test simulating a legitimate same-origin call must set one explicitly).
export const BASE_URL = `http://127.0.0.1:${PORT}`;

// Well-known default local Supabase CLI demo JWTs (not a secret -- shipped in every `supabase
// init` project, identical across all local installs, documented in Supabase's own CLI output).
// Matches the exact values already used by apps/admin/lib/supabase/__tests__/server.test.ts's own
// real-local-Supabase integration tests.
const LOCAL_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// Set at module scope (not just inside webServer.env below) so it's also inherited by the
// Playwright test-runner's own worker processes -- e2e/fixtures/testUser.ts calls the Supabase
// Admin API directly from a test file, a separate process from the dev server, and needs the same
// service-role key to do that.
process.env.SUPABASE_SERVICE_ROLE_KEY ??= LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= LOCAL_SUPABASE_ANON_KEY;

export default defineConfig({
  testDir: './e2e',
  // Default 30s per-test is too tight for this suite: dev-mode Turbopack compiles each route on
  // first visit within a freshly started server, and a single navigation's cold-compile latency
  // was observed live this session to exceed 15s on its own -- dev-environment-specific latency,
  // not applicable once this ever runs against a production build.
  timeout: 60_000,
  // Not parallelized: every test shares the same local Supabase instance and no per-worker
  // tenant/org isolation exists yet (TECHNICAL_DEBT_REGISTER.md TD-40) -- serial execution avoids
  // cross-test data races until that lands, at the cost of a slower suite for now.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Explicitly blanked, not omitted: apps/admin/.env.local (a real local dev convenience
      // file, NOT committed -- see .gitignore) sets NEXT_PUBLIC_DEMO_MODE=true/ALLOW_DEMO_MODE=true
      // AND points NEXT_PUBLIC_SUPABASE_URL at a real hosted Supabase project, not local Docker.
      // Node child processes inherit the parent's env, and Next.js's own env loader never
      // overrides a value already present in process.env with one from a .env file -- so every
      // one of these four keys MUST be set here explicitly (blank string, not left absent) or
      // the dev server this config starts silently inherits demo mode and/or a real hosted
      // project instead of local Supabase. Verified live this session: a server started without
      // these overrides showed "[Proplyst] Demo mode is ON" in its own startup log.
      NEXT_PUBLIC_DEMO_MODE: '',
      ALLOW_DEMO_MODE: '',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: LOCAL_SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_APP_URL: BASE_URL,
    },
  },
});
