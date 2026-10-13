import { defineConfig, devices } from '@playwright/test';

// Client-demo journey against an ALREADY RUNNING demo deployment (hosted or local `next start`). No web server is
// started here and nothing targets production: DEMO_BASE_URL must be given explicitly, and the demo login comes from
// DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD (never committed).
//   DEMO_BASE_URL=https://... DEMO_LOGIN_EMAIL=... DEMO_LOGIN_PASSWORD=... npx playwright test -c playwright.demo.config.ts
export default defineConfig({
  testDir: './e2e-demo',
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: { baseURL: process.env.DEMO_BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, grepInvert: /responsive/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /responsive/ },
  ],
});
