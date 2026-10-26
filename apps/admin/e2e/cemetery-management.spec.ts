import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { COLD_ROUTE_MS, createProperty, setUpOrg } from './fixtures/orgWorkflow';

// Cemetery Management (migration 184, docs/CEMETERY_MANAGEMENT.md): the whole client-demo journey through the real
// UI and API — set up a cemetery, sell (grant rights to) a site with a deposit, record a payment and get a receipt,
// record a burial, reserve a site, search/filter the layout, the dashboard's separate cemetery figures, a phone-width
// layout — plus double-sale and overpayment refusal, the module switch, and cross-organisation isolation.
// Screenshots go to docs/qa/cemetery-2026-10-26/ as evidence. Nothing here sends e-mail or WhatsApp.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const slowExpect = expect.configure({ timeout: COLD_ROUTE_MS });
const SHOTS = path.resolve(__dirname, '../../../docs/qa/cemetery-2026-10-26');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const money = (n: string) => new RegExp(`R\\s?${n.replace(/ /g, '\\s?')}`);

/** Cemetery Management is OFF for every organisation (migration 184); switched on per organisation by the owner. */
async function enableCemeteryForTests(orgId: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`, {
    method: 'PATCH',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cemetery_enabled: true }),
  });
  if (!r.ok) throw new Error(`enable cemetery ${r.status}: ${await r.text()}`);
}

const shared: { siteA1?: string; saleA1?: string; purchaser?: string } = {};

/** notFound() pages may stream with HTTP 200 in dev; what matters is that the record is not rendered. */
async function expectNotFound(page: Page, url: string) {
  await page.goto(url);
  await slowExpect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
}

test.describe.serial('Cemetery Management', () => {
  test('manager sets up a cemetery, sells a site with a deposit, receipts a payment, records a burial', async ({ page }) => {
    test.setTimeout(420_000);
    const { orgId } = await setUpOrg(page.request, 'cemetery');
    await enableCemeteryForTests(orgId);
    await createProperty(page.request, orgId, 'Cemetery Org Flat'); // the dashboard needs one property

    // --- empty state and setup
    await page.goto('/cemetery');
    await slowExpect(page.getByText('No cemetery set up yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cemetery register' })).toBeVisible(); // nav section present
    await page.getByRole('link', { name: 'Set up a cemetery' }).click();
    await slowExpect(page.getByRole('heading', { name: 'Set up a cemetery' })).toBeVisible();
    await page.getByPlaceholder('e.g. Greenfields Memorial Gardens').fill('E2E Memorial Park');
    await page.getByLabel('Sites', { exact: true }).first().fill('12');
    await page.getByLabel('List price (ZAR)').first().fill('15000');
    await page.getByRole('button', { name: '+ Add section' }).click();
    await page.getByLabel('Sites', { exact: true }).nth(1).fill('8');
    await shot(page, '01-setup');
    await page.getByRole('button', { name: 'Create cemetery' }).click();
    await slowExpect(page.getByRole('heading', { name: 'E2E Memorial Park' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^A-012:/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^B-008:/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^A-013:/ })).toHaveCount(0);

    // --- select a site, then the sale workflow
    await page.getByRole('button', { name: /^A-001:/ }).click();
    await expect(page.getByRole('heading', { name: 'A-001' })).toBeVisible();
    await shot(page, '02-layout-site-selected');
    await page.getByRole('link', { name: 'Grant rights' }).click();
    await slowExpect(page.getByRole('heading', { name: /New grant of rights/ })).toBeVisible();
    await expect(page.getByLabel('Grave site')).toHaveValue(/.+/);
    await page.getByLabel('Full name').fill('Edith Mbeki (e2e)');
    await page.getByLabel('Contact number').first().fill('010 555 0100');
    await expect(page.getByLabel('Rights fee (ZAR)')).toHaveValue('15000');
    await page.getByLabel('Deposit / payment received now (ZAR)').fill('5000');
    await expect(page.getByText(money('10 000,00')).first()).toBeVisible();
    await shot(page, '03-sale-form');
    await page.getByRole('button', { name: 'Record grant of rights' }).click();
    await slowExpect(page.getByText('Grant of burial rights recorded.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Grant of Right of Interment' })).toBeVisible();
    await expect(page.getByText(money('10 000,00')).first()).toBeVisible();
    shared.saleA1 = page.url().split('/cemetery/sales/')[1]!.split('?')[0];
    shared.siteA1 = (await page.getByRole('link', { name: /Grave site A-001/ }).getAttribute('href'))!.split('/').pop();
    shared.purchaser = (await page.getByRole('link', { name: 'Edith Mbeki (e2e)' }).first().getAttribute('href'))!.split('/').pop();
    await shot(page, '04-sale-record');

    // --- the database refuses a second sale and an overpayment, whatever the client sends
    const again = await page.request.post('/api/v1/cemetery/sales', {
      headers: { Origin: BASE_URL },
      data: { siteId: shared.siteA1, purchaserId: shared.purchaser, price: 1000, saleDate: '2026-10-26', deposit: 0 },
    });
    expect(again.status()).toBe(409);
    const over = await page.request.post(`/api/v1/cemetery/sales/${shared.saleA1}/payments`, {
      headers: { Origin: BASE_URL },
      data: { amount: 10000.01, paidOn: '2026-10-26', method: 'eft' },
    });
    expect(over.status()).toBe(409);
    expect((await over.json()).error.code).toBe('cemetery_payment_exceeds_balance');

    // --- record a payment -> receipt with the balance after it
    await page.getByLabel('Amount received (ZAR)').fill('4000');
    await page.getByRole('button', { name: 'Record payment & issue receipt' }).click();
    await slowExpect(page.getByRole('heading', { name: 'Receipt' })).toBeVisible();
    await expect(page.getByText('DEMONSTRATION RECEIPT')).toHaveCount(0); // not a demo cemetery
    await expect(page.getByText(/GR-\d{6}/).first()).toBeVisible();
    await expect(page.locator('div').filter({ hasText: /^Balance outstanding/ }).last()).toContainText(money('6 000,00'));
    await shot(page, '05-receipt');

    // --- burial: sale status stays sold, burial status becomes occupied
    await page.goto(`/cemetery/sites/${shared.siteA1}`);
    await slowExpect(page.getByRole('heading', { name: 'Grave site A-001' })).toBeVisible();
    await expect(page.getByText('Rights granted').first()).toBeVisible();
    await expect(page.getByText('Unused').first()).toBeVisible();
    await page.getByRole('button', { name: 'Record burial' }).click();
    await page.getByLabel('Full name of the deceased').fill('Albert Mbeki (e2e)');
    await page.locator('form').getByRole('button', { name: 'Record burial' }).click();
    await slowExpect(page.getByText('Albert Mbeki (e2e)')).toBeVisible();
    await expect(page.getByText('Occupied').first()).toBeVisible();
    await expect(page.getByText('Rights granted').first()).toBeVisible();
    await shot(page, '06-site-after-burial');

    // --- reserve another site for the same rights holder
    await page.goto('/cemetery');
    await slowExpect(page.getByRole('button', { name: /^A-002:/ })).toBeVisible();
    await page.getByRole('button', { name: /^A-002:/ }).click();
    await page.getByRole('link', { name: 'Open site record' }).click();
    await slowExpect(page.getByRole('heading', { name: 'Grave site A-002' })).toBeVisible();
    await page.getByRole('button', { name: 'Reserve' }).click();
    await page.getByLabel('For rights holder').selectOption({ label: 'Edith Mbeki (e2e)' });
    await page.getByRole('button', { name: 'Reserve site' }).click();
    await slowExpect(page.getByText('Reserved', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Release reservation' })).toBeVisible();

    // --- overview metrics, search and filters
    await page.goto('/cemetery');
    await slowExpect(page.getByRole('heading', { name: 'E2E Memorial Park' })).toBeVisible();
    const tile = (label: string) => page.locator('.panel').filter({ has: page.getByText(label, { exact: true }) }).first();
    await expect(tile('Grave sites')).toContainText('20');
    await expect(tile('Reserved')).toContainText('1');
    await expect(tile('Occupied')).toContainText('1');
    await expect(tile('Outstanding balances')).toContainText(money('6 000'));
    await expect(tile('Payments received')).toContainText(money('9 000'));
    await page.getByLabel('Search grave sites').fill('Mbeki');
    await expect(page.getByText('2 of 20 sites match')).toBeVisible(); // holder of A-001 and reservation on A-002
    await page.getByLabel('Search grave sites').fill('');
    await page.getByRole('group', { name: 'Filter by sale status' }).getByRole('button', { name: /^Available/ }).click();
    await expect(page.getByText('18 of 20 sites match')).toBeVisible();
    await shot(page, '07-overview-filtered');

    // --- rights holder holds multiple sites; the purchaser record shows them
    await page.goto(`/cemetery/purchasers/${shared.purchaser}`);
    await slowExpect(page.getByRole('heading', { name: 'Edith Mbeki (e2e)' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'A-001' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'A-002' })).toBeVisible();

    // --- dashboard: separate cemetery panel, rental KPIs untouched
    await page.goto('/dashboard');
    await slowExpect(page.getByText('Cemetery operations')).toBeVisible();
    await expect(page.getByText('Grave-site payments (capital receipts)')).toBeVisible();
    await expect(page.getByText('Rental income (rent collected)')).toBeVisible();
    await shot(page, '08-dashboard');

    // --- phone width: no horizontal page scroll on the layout, the sale record and the receipt
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ['/cemetery', `/cemetery/sales/${shared.saleA1}`, `/cemetery/sites/${shared.siteA1}`]) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${url} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
    }
    await page.goto('/cemetery');
    await page.getByRole('button', { name: /^A-003:/ }).click();
    await expect(page.getByRole('heading', { name: 'A-003' })).toBeVisible();
    await shot(page, '09-phone-layout');
  });

  test('module off: no navigation, no pages, no API; another organisation cannot reach these records', async ({ browser }) => {
    test.setTimeout(300_000);
    expect(shared.siteA1, 'first test must run first').toBeTruthy();

    // An existing-customer-style organisation with the module off.
    const offCtx = await browser.newContext({ baseURL: BASE_URL });
    const off = await offCtx.newPage();
    const { orgId: offOrg } = await setUpOrg(off.request, 'cemetery-off');
    await createProperty(off.request, offOrg, 'Ordinary Customer Flat');
    await off.goto('/dashboard');
    await slowExpect(off.getByRole('link', { name: 'Properties' }).first()).toBeVisible();
    await expect(off.getByRole('link', { name: 'Cemetery register' })).toHaveCount(0);
    await expect(off.getByText('Cemetery operations')).toHaveCount(0);
    await expectNotFound(off, '/cemetery');
    await expectNotFound(off, `/cemetery/sites/${shared.siteA1}`);
    const offApi = await off.request.post('/api/v1/cemetery/purchasers', { headers: { Origin: BASE_URL }, data: { fullName: 'Nope' } });
    expect(offApi.status()).toBe(403);
    // Existing property workflows are untouched for this organisation.
    await off.goto('/properties');
    await slowExpect(off.getByText('Ordinary Customer Flat').first()).toBeVisible();
    await offCtx.close();

    // A different organisation WITH the module on still cannot see or touch the first organisation's records.
    const otherCtx = await browser.newContext({ baseURL: BASE_URL });
    const other = await otherCtx.newPage();
    const { orgId: otherOrg } = await setUpOrg(other.request, 'cemetery-other');
    await enableCemeteryForTests(otherOrg);
    await expectNotFound(other, `/cemetery/sites/${shared.siteA1}`);
    await expectNotFound(other, `/cemetery/sales/${shared.saleA1}`);
    await expectNotFound(other, `/cemetery/purchasers/${shared.purchaser}`);
    const pay = await other.request.post(`/api/v1/cemetery/sales/${shared.saleA1}/payments`, {
      headers: { Origin: BASE_URL },
      data: { amount: 1, paidOn: '2026-10-26', method: 'cash' },
    });
    expect(pay.status()).toBe(404);
    const sell = await other.request.post('/api/v1/cemetery/sales', {
      headers: { Origin: BASE_URL },
      data: { siteId: shared.siteA1, newPurchaser: { fullName: 'Intruder' }, price: 100, saleDate: '2026-10-26', deposit: 0 },
    });
    expect(sell.status()).toBe(404);
    await other.goto('/cemetery');
    await slowExpect(other.getByText('No cemetery set up yet')).toBeVisible(); // sees only its own (none)
    await otherCtx.close();
  });
});
