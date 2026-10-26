import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { COLD_ROUTE_MS } from './fixtures/orgWorkflow';

// The year of demo history (scripts/cemetery-demo) as a user sees it: the property dashboard with month / year /
// 12-month filters, the Reports 12-month table, the cemetery reports with a month drill-down, a site's history and the
// cancelled-sales register. Runs only when the CI workflow has provisioned the demo organisation and points
// CEMDEMO_CREDENTIALS_FILE at the git-ignored file the provisioner wrote the login to.

const slowExpect = expect.configure({ timeout: COLD_ROUTE_MS });
const CREDS = process.env.CEMDEMO_CREDENTIALS_FILE ?? '';
const SHOTS = path.resolve(__dirname, '../test-results/demo-year');

function credentials(): { email: string; password: string } | null {
  if (!CREDS || !fs.existsSync(CREDS)) return null;
  const text = fs.readFileSync(CREDS, 'utf8');
  const email = /CEMDEMO_LOCAL_EMAIL=(.+)/.exec(text)?.[1]?.trim();
  const password = /CEMDEMO_LOCAL_PASSWORD=(.+)/.exec(text)?.[1]?.trim();
  return email && password ? { email, password } : null;
}

async function login(page: Page) {
  const c = credentials();
  test.skip(!c, 'demo year not provisioned (CEMDEMO_CREDENTIALS_FILE unset)');
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(c!.email);
  await page.locator('input[type="password"]').fill(c!.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: COLD_ROUTE_MS });
}

const shot = async (page: Page, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(2_000); // let chart entry animations finish so the evidence shows the full series
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};

test.describe.serial('demo year of operations', () => {
  test('dashboard: 12-month trend, month and year filters, separate cemetery figures', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await login(page);
    await page.goto('/dashboard');
    await slowExpect(page.getByText('Cemetery operations')).toBeVisible();
    await expect(page.getByText(/last 12 months/).first()).toBeVisible();
    await shot(page, '01-dashboard-this-month');
    await page.getByRole('combobox', { name: /^Period/ }).selectOption('last_12_months');
    await slowExpect(page.getByText(/performing in the last 12 months/)).toBeVisible();
    await page.getByLabel('Show a single month').fill('2026-03');
    await page.getByLabel('Show a single month').dispatchEvent('change');
    await slowExpect(page.getByText(/performing in March 2026/)).toBeVisible();
    await shot(page, '02-dashboard-march-2026');
    await page.getByLabel('Show a calendar year').selectOption('2026');
    await slowExpect(page.getByText(/performing in 2026/)).toBeVisible();
  });

  test('reports: twelve months of rent, collections, expenses and occupancy', async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    await page.goto('/reports');
    const panel = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Monthly performance' }) });
    await slowExpect(panel).toBeVisible();
    await expect(panel.locator('tbody tr')).toHaveCount(12);
    await expect(panel.getByRole('link', { name: 'Nov 2025' })).toBeVisible();
    await expect(panel.getByRole('cell', { name: '12 months' })).toBeVisible();
    await shot(page, '03-reports');
    await panel.getByRole('link', { name: 'Feb 2026' }).click();
    await slowExpect(page.getByText(/performing in February 2026/)).toBeVisible();
    await page.goto('/accounting/invoices');
    await slowExpect(page.getByText(/INV-\d+/).first()).toBeVisible();
  });

  test('cemetery reports: monthly sales, collections, burials; drill into February 2026', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await login(page);
    await page.goto('/cemetery/reports');
    await slowExpect(page.getByRole('heading', { name: 'Cemetery reports' })).toBeVisible();
    const table = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Monthly breakdown' }) });
    await expect(table.locator('tbody tr')).toHaveCount(12);
    await expect(table.locator('tfoot')).toContainText('Total');
    await shot(page, '04-cemetery-reports');
    await page.getByLabel('Inspect month').selectOption('2026-02');
    await slowExpect(
      page.getByRole('heading', { name: 'Transactions in February 2026' }),
    ).toBeVisible();
    await expect(page.getByText('B-014').first()).toBeVisible(); // the reserve → deposit → settle story
    await shot(page, '05-cemetery-february');
    await page.getByLabel('Report period').selectOption('2026');
    await slowExpect(page.getByText(/^Year 2026 ·/)).toBeVisible();
  });

  test('site history, a settled payment plan, cancellations', async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    await page.goto('/cemetery/sales?filter=cancelled');
    const rows = page.locator('tbody tr');
    await slowExpect(rows.first()).toBeVisible();
    await expect(rows).toHaveCount(3);
    await page.goto('/cemetery/purchasers');
    await slowExpect(page.getByRole('link', { name: 'Kavitha Moodley' })).toBeVisible();
    await page.getByRole('link', { name: 'Kavitha Moodley' }).click();
    const payments = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Payment history' }) });
    await slowExpect(payments.locator('tbody tr')).toHaveCount(7);
    await page.getByRole('link', { name: 'B-014' }).first().click();
    const history = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Site history' }) });
    await slowExpect(history).toContainText('Reserved');
    await expect(history).toContainText('Sold / rights granted');
    await shot(page, '06-site-history-b014');
  });
});
