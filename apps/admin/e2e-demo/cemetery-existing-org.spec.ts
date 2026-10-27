import { test, expect, type Page } from '@playwright/test';

// An EXISTING organisation (Cemetery Management off, migration 184) on the deployed site: no cemetery navigation,
// pages or API, and its usual property pages still load. Read-only: the only writes attempted are cemetery POSTs that
// must be refused before anything is created.
//   DEMO_BASE_URL=https://proplyst.co.za EXISTING_LOGIN_EMAIL=... EXISTING_LOGIN_PASSWORD=...
//   npx playwright test -c playwright.demo.config.ts e2e-demo/cemetery-existing-org.spec.ts

const EMAIL = process.env.EXISTING_LOGIN_EMAIL ?? '';
const PASSWORD = process.env.EXISTING_LOGIN_PASSWORD ?? '';
const slow = (ms = 60_000) => expect.configure({ timeout: ms });

async function login(page: Page) {
  test.skip(
    !process.env.DEMO_BASE_URL || !EMAIL || !PASSWORD,
    'DEMO_BASE_URL / EXISTING_LOGIN_EMAIL / EXISTING_LOGIN_PASSWORD not set',
  );
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
}

async function noErrorBanner(page: Page) {
  await expect(
    page.getByText(
      /Unexpected response from the server|Something went wrong|Application error|Page not found/i,
    ),
  ).toHaveCount(0);
}

test('an existing organisation sees no cemetery navigation, pages, panel or API', async ({
  page,
}) => {
  await login(page);
  await page.goto('/dashboard');
  await slow()(page.getByText('Rent collected').first()).toBeVisible();
  await expect(page.getByText('Cemetery operations')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: /^(Cemetery|Grave sites|Rights holders|Burials)/ }),
  ).toHaveCount(0);

  for (const url of ['/cemetery', '/cemetery/sales', '/cemetery/purchasers', '/cemetery/reports']) {
    const r = await page.goto(url);
    expect(r?.status(), `${url} is not available to this organisation`).toBe(404);
  }

  const origin = { Origin: process.env.DEMO_BASE_URL! };
  const purchaser = await page.request.post('/api/v1/cemetery/purchasers', {
    headers: origin,
    data: { fullName: 'Isolation check (fictional)' },
  });
  expect(purchaser.status()).toBe(403);
  expect((await purchaser.json()).error.code).toBe('cemetery_unavailable');
  const sale = await page.request.post('/api/v1/cemetery/sales', {
    headers: origin,
    data: {
      siteId: '00000000-0000-4000-8000-000000000000',
      newPurchaser: { fullName: 'Isolation check (fictional)' },
      price: 1000,
      deposit: 0,
    },
  });
  expect(sale.status()).toBe(403);
});

test('the existing organisation’s property pages and reports still load', async ({ page }) => {
  await login(page);
  for (const url of [
    '/dashboard',
    '/dashboard?period=last_12_months',
    '/properties',
    '/units',
    '/tenants',
    '/leases',
    '/maintenance',
    '/accounting',
    '/reports',
  ]) {
    const r = await page.goto(url);
    expect(r?.status(), url).toBeLessThan(400);
    await page.waitForLoadState('networkidle');
    await noErrorBanner(page);
  }

  await page.goto('/properties');
  const first = page.locator('a[href^="/properties/"]:not([href$="/new"])').first();
  await slow()(first).toBeVisible();
  await first.click();
  await page.waitForURL(/\/properties\/[0-9a-f-]{36}/);
  await page.waitForLoadState('networkidle');
  await noErrorBanner(page);

  await page.goto('/reports');
  const monthly = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Monthly performance' }) });
  await slow()(monthly.locator('tbody tr')).toHaveCount(12);
  await noErrorBanner(page);
});
