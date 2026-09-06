import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // `server-only` unconditionally throws under plain Node resolution -- only Next.js's
      // webpack build substitutes a no-op for the real server bundle. Every apps/admin/lib file
      // starts with `import 'server-only'`; without this alias, no such file could ever be unit
      // tested directly. See test/server-only-stub.ts for the full explanation.
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
      // Mirrors tsconfig.json's `"@/*": ["./*"]` -- Vite/Vitest doesn't read tsconfig `paths`
      // itself, so component tests that exercise a `@/...`-importing component (first needed by
      // TASKS.md M20's UnitsTable test) would otherwise fail module resolution even though the
      // same import resolves fine under Next.js's own webpack build.
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // e2e/*.spec.ts (Stage 6, commercial-launch execution plan) are Playwright tests, run via
    // `pnpm test:e2e`, never vitest -- vitest's default include glob otherwise picks up any
    // *.spec.ts file anywhere in the project and tries (and fails) to execute Playwright's own
    // test() as if it were a vitest test.
    exclude: ['**/node_modules/**', '**/e2e/**'],
    // Run test FILES one at a time (V1 release-gate pass). Almost every suite here is a real
    // integration test against ONE shared local Supabase instance, not an isolated unit test, so
    // parallel files actively fight each other over shared global state. Before this, a full run
    // failed 6 files / 11 tests that every one of which passed when run individually:
    //
    //   - GoTrue auth throttling under parallel sign-in churn surfaced as
    //     "AuthApiError: Invalid login credentials" in propertyLifecycle.test.ts, which looks
    //     exactly like a real authorization regression and is not one.
    //   - Storage/Postgres contention pushed photos/, documents/ and whatsappDispatch past their
    //     5s/10s test and hook timeouts.
    //   - daily-jobs' idempotency test sweeps EVERY org in the database twice and asserts the
    //     second sweep creates nothing; any other file creating a lease in between makes that
    //     assertion fail (it reported 42 created rows), which reads as a broken idempotency
    //     guarantee when the guarantee is actually intact.
    //
    // The cost is wall-clock time; the benefit is that a red suite now means a real defect
    // instead of a coin flip, which is the only way this suite can gate a release. Individual
    // files still run their own tests concurrently -- only cross-file parallelism is disabled.
    fileParallelism: false,
  },
});
