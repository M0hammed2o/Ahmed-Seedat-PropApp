import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Runs ONLY the pilot demonstration seeder and the scale benchmark (scripts/utilities-pilot-demo, scripts/utilities-scale)
// — never part of `vitest run`. Pass a path to pick one.
// Usage and guards: docs/UTILITIES_PILOT_DEMO.md.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['scripts/utilities-pilot-demo/*.demo.ts', 'scripts/utilities-scale/*.scale.ts', 'scripts/client-demo/*.demo.ts'],
      exclude: ['**/node_modules/**'],
    },
  }),
);
