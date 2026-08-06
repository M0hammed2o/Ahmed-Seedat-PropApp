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
  },
});
