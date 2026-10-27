import { test, expect, type Page } from '@playwright/test';

// Cemetery + property demo, end to end, against the DEPLOYED site (playwright.demo.config.ts), logged in as the demo
// organisation "Proplyst Property & Cemetery Demo" (docs/CEMETERY_MANAGEMENT.md). Writes ONLY inside that fictional
// organisation's demo cemetery: a reservation that is released again, and — only with LIVE_TEST_SALE=1 — one
// demo-flagged grant with a deposit and a payment that is then cancelled. Refusal checks write nothing.
//   DEMO_BASE_URL=https://proplyst.co.za DEMO_LOGIN_EMAIL=... DEMO_LOGIN_PASSWORD=... [DEMO_FOREIGN_PROPERTY_ID=...]
//   npx playwright test -c playwright.demo.config.ts e2e-demo/cemetery-live.spec.ts

const EMAIL = process.env.DEMO_LOGIN_EMAIL ?? '';
const PASSWORD = process.env.DEMO_LOGIN_PASSWORD ?? '';
const slow = (ms = 60_000) => expect.configure({ timeout: ms });
const money = (n: string) => new RegExp(`R\\s?${n.replace(/ /g, '\\s?')}`);
// Today's business date in South Africa (the database refuses anything dated after it, and orders site history by it).
const TODAY = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);

async function login(page: Page) {
  test.skip(
    !process.env.DEMO_BASE_URL || !EMAIL || !PASSWORD,
    'DEMO_BASE_URL / DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD not set',
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

test('dashboard: rental KPIs plus a separate cemetery panel', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await slow()(page.getByText('Rent collected').first()).toBeVisible();
  await slow()(page.getByText('Cemetery operations')).toBeVisible();
  await expect(page.getByText('Rental income (rent collected)')).toBeVisible();
  await expect(page.getByText('Grave-site payments (capital receipts)')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cemetery register' })).toBeVisible();
  await noErrorBanner(page);
});

test('residential and commercial properties, units, tenants, leases, invoices, maintenance', async ({
  page,
}) => {
  await login(page);
  await page.goto('/properties');
  await slow()(page.getByText('Riverside Heights Apartments').first()).toBeVisible();
  await expect(page.getByText('Northgate Business Centre').first()).toBeVisible();
  await page.getByText('Riverside Heights Apartments').first().click();
  await page.waitForURL(/\/properties\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await slow()(page.getByRole('heading', { name: 'Riverside Heights Apartments' })).toBeVisible();
  await page.getByRole('button', { name: /^Units/ }).click();
  await slow()(page.getByText('Unit 206').first()).toBeVisible();
  await page.goto('/tenants');
  await slow()(page.getByText('Khumalo & Partners Attorneys Inc.').first()).toBeVisible();
  await page.goto('/leases');
  await slow()(page.getByText(/Northgate|Riverside|Unit 101|Shop 1/).first()).toBeVisible();
  await page.goto('/accounting/invoices');
  await slow()(page.getByText(/INV-\d+/).first()).toBeVisible();
  await page.goto('/maintenance');
  await slow()(page.getByText('Geyser leaking into ceiling').first()).toBeVisible();
  await noErrorBanner(page);
  const foreign = process.env.DEMO_FOREIGN_PROPERTY_ID;
  if (foreign) {
    const r = await page.request.get(`/api/v1/properties/${foreign}`);
    expect([403, 404]).toContain(r.status());
  }
});

test('cemetery register: 120 sites, layout details, search and filters', async ({ page }) => {
  await login(page);
  await page.goto('/cemetery');
  await slow()(page.getByRole('heading', { name: 'Greenfields Memorial Gardens' })).toBeVisible();
  await expect(page.getByText('Demonstration data.')).toBeVisible();
  await expect(
    page
      .locator('.panel')
      .filter({ has: page.getByText('Grave sites', { exact: true }) })
      .first(),
  ).toContainText('120');
  await page.getByRole('button', { name: /^A-001:/ }).click();
  await expect(page.getByRole('heading', { name: 'A-001' })).toBeVisible();
  await expect(page.getByText('Rights holder').first()).toBeVisible();
  await page
    .getByRole('group', { name: 'Filter by sale status' })
    .getByRole('button', { name: /^Reserved/ })
    .click();
  await expect(page.getByText(/of 120 sites match/)).toBeVisible();
  await page.getByLabel('Search grave sites').fill('Naidoo');
  await expect(page.getByText(/of 120 sites match/)).toBeVisible();
  await page.goto('/cemetery/purchasers');
  await slow()(page.getByText('Priya Naidoo').first()).toBeVisible();
  await page.goto('/cemetery/burials');
  await slow()(page.getByText(/interments? recorded/)).toBeVisible();
  await page.goto('/cemetery/sales?filter=outstanding');
  await slow()(page.getByText(/GS-\d{6}/).first()).toBeVisible();
  await noErrorBanner(page);
});

test('a year of history: dashboard filters, Reports, cemetery reports, a settled plan and cancellations', async ({
  page,
}) => {
  await login(page);
  await page.goto('/dashboard?period=last_12_months');
  await slow()(page.getByText(/performing in the last 12 months/)).toBeVisible();
  await page.goto('/dashboard?period=custom&from=2026-03-01&to=2026-03-31');
  await slow()(page.getByText(/performing in March 2026/)).toBeVisible();
  await page.goto('/reports');
  const monthly = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Monthly performance' }) });
  await slow()(monthly.locator('tbody tr')).toHaveCount(12);
  await page.goto('/cemetery/reports');
  const breakdown = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Monthly breakdown' }) });
  await slow()(breakdown.locator('tbody tr')).toHaveCount(12);
  await page.getByLabel('Inspect month').selectOption('2026-02');
  await slow()(page.getByRole('heading', { name: 'Transactions in February 2026' })).toBeVisible();
  await page.goto('/cemetery/sales?filter=cancelled');
  await slow()(page.locator('tbody tr').first()).toBeVisible();
  expect(await page.locator('tbody tr').count()).toBeGreaterThanOrEqual(3);
  await page.goto('/cemetery/purchasers');
  await page.getByRole('link', { name: 'Kavitha Moodley' }).click();
  const payments = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Payment history' }) });
  await slow()(payments.locator('tbody tr').filter({ hasText: 'B-014' })).toHaveCount(7);
  await noErrorBanner(page);
});

test('live write checks on the demo cemetery: refusals, reserve and release; optional test sale', async ({
  page,
}) => {
  await login(page);
  const origin = { Origin: process.env.DEMO_BASE_URL! };
  // A sold site cannot be sold again; nothing is written.
  await page.goto('/cemetery');
  await slow()(page.getByRole('heading', { name: 'Greenfields Memorial Gardens' })).toBeVisible();
  await page.getByRole('button', { name: /^A-001:/ }).click();
  const soldSiteId = (await page
    .getByRole('link', { name: 'Open site record' })
    .getAttribute('href'))!
    .split('/')
    .pop()!;
  const again = await page.request.post('/api/v1/cemetery/sales', {
    headers: origin,
    data: {
      siteId: soldSiteId,
      newPurchaser: { fullName: 'Second buyer (fictional)' },
      price: 1000,
      saleDate: TODAY,
      deposit: 0,
    },
  });
  expect(again.status(), 'a sold site cannot be sold again').toBe(409);
  // No payment above a balance; nothing is written.
  await page.goto('/cemetery/sales?filter=outstanding');
  await page
    .getByRole('link', { name: /GS-\d{6}/ })
    .first()
    .click();
  const owingSaleId = page.url().split('/cemetery/sales/')[1]!.split('?')[0]!;
  const over = await page.request.post(`/api/v1/cemetery/sales/${owingSaleId}/payments`, {
    headers: origin,
    data: { amount: 99_999_999, paidOn: TODAY, method: 'eft' },
  });
  expect(over.status(), 'no payment above the balance').toBe(409);

  // Reserve an available site for an existing rights holder and release it again (net zero).
  await page.goto('/cemetery');
  const next = page.getByRole('button', { name: /^C-\d{3}: Available/ }).first();
  await slow()(next).toBeVisible();
  await next.click();
  await page.getByRole('link', { name: 'Open site record' }).click();
  await slow()(page.getByRole('button', { name: 'Reserve' })).toBeVisible();
  await page.getByRole('button', { name: 'Reserve' }).click();
  await page.getByLabel('For rights holder').selectOption({ label: 'Priya Naidoo' });
  await page.getByRole('button', { name: 'Reserve site' }).click();
  await slow()(page.getByRole('button', { name: 'Release reservation' })).toBeVisible();
  await page.getByRole('button', { name: 'Release reservation' }).click();
  await slow()(page.getByRole('button', { name: 'Reserve' })).toBeVisible();

  // Optional (LIVE_TEST_SALE=1, owner-approved): a full grant -> deposit -> payment -> receipt on the live site,
  // cancelled again at the end so the site is free. It stays visible as a cancelled sale.
  if (process.env.LIVE_TEST_SALE === '1') {
    await page.goto('/cemetery');
    const site = page.getByRole('button', { name: /^C-\d{3}: Available/ }).first();
    await site.click();
    await page.locator('aside').getByRole('link', { name: 'Grant rights' }).click();
    await slow()(page.getByRole('heading', { name: /New grant of rights/ })).toBeVisible();
    await page.getByRole('radio', { name: /New rights holder/ }).click();
    await page.getByLabel('Full name').fill('Deployment Check (fictional)');
    await page.getByLabel('Deposit / payment received now (ZAR)').fill('3000');
    await page.getByRole('button', { name: 'Record grant of rights' }).click();
    await slow()(page.getByText('Grant of burial rights recorded.')).toBeVisible();
    await expect(page.getByText('DEMONSTRATION — not a real transaction')).toBeVisible();
    const saleUrl = page.url().split('?')[0]!;
    await page.getByLabel('Amount received (ZAR)').fill('1000');
    await page.getByRole('button', { name: 'Record payment & issue receipt' }).click();
    await slow()(page.getByRole('heading', { name: 'Receipt' })).toBeVisible();
    await expect(page.getByText(/DEMONSTRATION RECEIPT/)).toBeVisible();
    await expect(page.getByText(money('1 000,00')).first()).toBeVisible();
    await page.goto(saleUrl);
    await page.getByRole('button', { name: 'Cancel grant' }).click();
    await page.getByLabel('Reason for cancellation').fill('Live deployment check (fictional)');
    await page.getByRole('button', { name: 'Confirm cancellation' }).click();
    await slow()(page.getByText(/^CANCELLED /)).toBeVisible();
  }
  await noErrorBanner(page);
});

test('responsive: the cemetery layout fits a phone and a site opens', async ({ page }) => {
  await login(page);
  for (const url of [
    '/cemetery',
    '/cemetery/sales',
    '/cemetery/purchasers',
    '/cemetery/reports',
    '/dashboard',
    '/reports',
  ]) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${url} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
  }
  await page.goto('/cemetery');
  await page.getByRole('button', { name: /^B-010:/ }).click();
  await expect(page.getByRole('heading', { name: 'B-010' })).toBeVisible();
  await page.screenshot({ path: 'test-results/cemetery-live-phone.png', fullPage: true });
});
