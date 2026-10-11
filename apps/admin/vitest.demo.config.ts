import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Runs ONLY the pilot demonstration seeder (scripts/utilities-pilot-demo/seed.demo.ts) — never part of `vitest run`.
// Usage and guards: docs/UTILITIES_PILOT_DEMO.md.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['scripts/utilities-pilot-demo/*.demo.ts'],
      exclude: ['**/node_modules/**'],
    },
  }),
);
