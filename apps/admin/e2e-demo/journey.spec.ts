import { test, expect, type Page } from '@playwright/test';

// The client-demo journey, end to end, against the deployed demo (see playwright.demo.config.ts).
// Fails loudly on any dead navigation, error banner or empty Utilities dashboard.

const EMAIL = process.env.DEMO_LOGIN_EMAIL ?? '';
const PASSWORD = process.env.DEMO_LOGIN_PASSWORD ?? '';
const slow = (ms = 45_000) => expect.configure({ timeout: ms });

async function login(page: Page) {
  test.skip(!process.env.DEMO_BASE_URL || !EMAIL || !PASSWORD, 'DEMO_BASE_URL / DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD not set');
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
}

async function noErrorBanner(page: Page) {
  await expect(page.getByText(/Unexpected response from the server|Something went wrong|Application error/i)).toHaveCount(0);
}

async function openDemoProperty(page: Page) {
  await page.goto('/properties');
  await slow()(page.getByText('DEMO Ridgeview Apartments').first()).toBeVisible();
  await page.getByText('DEMO Ridgeview Apartments').first().click();
  await page.waitForURL(/\/properties\/[0-9a-f-]{36}/, { timeout: 60_000 });
  return page.url().match(/\/properties\/([0-9a-f-]{36})/)![1]!;
}

test('login → dashboard → property → units & tenants', async ({ page }) => {
  await login(page);
  await slow()(page.getByRole('heading').first()).toBeVisible();
  await noErrorBanner(page);
  const id = await openDemoProperty(page);
  await slow()(page.getByRole('heading', { name: 'DEMO Ridgeview Apartments' })).toBeVisible();
  await page.getByRole('button', { name: /^Units/ }).click();
  await slow()(page.getByText('Unit 6').first()).toBeVisible();
  await page.getByRole('button', { name: /^Tenants/ }).click();
  await slow()(page.getByText(/Thandiwe Mokoena/).first()).toBeVisible();
  await noErrorBanner(page);
  expect(id).toBeTruthy();
});

test('Smart Utilities: dashboard, solar/battery/water sources, meters, alerts — never empty', async ({ page }) => {
  await login(page);
  const id = await openDemoProperty(page);
  await page.goto(`/properties/${id}?tab=Utilities`);
  await slow()(page.getByText('Utility monitoring')).toBeVisible();
  await slow()(page.getByText('Supply & sources')).toBeVisible();
  for (const name of ['Rooftop solar 12 kWp', 'Battery 20 kWh', 'Diesel generator 15 kVA', 'eThekwini water (municipal)', 'Borehole (garden & tank top-up)', 'JoJo tanks 10 000 L']) {
    await slow()(page.getByText(name).first()).toBeVisible();
  }
  await slow()(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
  await expect(page.getByText('No alerts.')).toHaveCount(0); // the demo has real rule-based alerts
  await slow()(page.getByText(/JoJo tanks 10 000 L is low/).first()).toBeVisible();
  await slow()(page.getByRole('heading', { name: 'Meters', exact: true })).toBeVisible();
  await slow()(page.getByText('DEMO-ETH-W-9930').first()).toBeVisible();
  await expect(page.locator('svg').first()).toBeVisible(); // charts render
  await noErrorBanner(page);
});

test('tariffs, draft charges (calculate live), statements and municipal preview', async ({ page }) => {
  await login(page);
  const id = await openDemoProperty(page);
  await page.goto(`/properties/${id}?tab=Utilities`);
  const billing = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Utility recharges' }) }).last();
  await slow()(billing.getByText(/DEMO FICTIONAL electricity/).first()).toBeVisible();
  await slow()(billing.getByText(/DEMO FICTIONAL water/).first()).toBeVisible();
  await slow()(billing.getByText(/Approved|On draft invoice/).first()).toBeVisible();

  // Calculate draft charges for the month BEFORE the pre-billed one (left uncalculated for the live demo).
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  await billing.getByLabel('From', { exact: true }).last().fill(from);
  await billing.getByLabel('To (exclusive)').fill(to);
  await billing.getByRole('button', { name: 'Calculate charges' }).click();
  await slow(90_000)(billing.getByText('Draft estimate').first()).toBeVisible();

  const statements = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Utility statements' }) }).last();
  await slow()(statements.getByText(/Thandiwe Mokoena/).first()).toBeVisible();
  const pdfHref = await statements.getByRole('link', { name: 'PDF' }).first().getAttribute('href');
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');

  const municipal = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Monthly municipal readings' }) }).last();
  await municipal.getByRole('button', { name: 'Save settings' }).click();
  await slow()(municipal.getByText(/^Saved/)).toBeVisible();
  await municipal.getByRole('button', { name: 'Preview saved email' }).click();
  await slow(90_000)(municipal.locator('iframe[title="PDF report preview"]')).toBeVisible();
  await noErrorBanner(page);
});

test('portfolio utilities page and reports open', async ({ page }) => {
  await login(page);
  await page.goto('/utilities');
  await slow()(page.getByRole('link', { name: 'DEMO Ridgeview Apartments' })).toBeVisible();
  await page.goto('/reports');
  await slow()(page.getByRole('heading').first()).toBeVisible();
  await noErrorBanner(page);
});

test('responsive: Utilities on a phone has no horizontal overflow', async ({ page }) => {
  await login(page);
  const id = await openDemoProperty(page);
  await page.goto(`/properties/${id}?tab=Utilities`);
  await slow()(page.getByText('Supply & sources')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
