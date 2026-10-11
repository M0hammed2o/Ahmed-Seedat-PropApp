import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit, enableSmartUtilitiesForTests } from './fixtures/orgWorkflow';

// Hybrid utilities browser walk-through (docs/HYBRID_UTILITIES_ARCHITECTURE.md): add a supply source, a flat
// electricity tariff with a calculation preview, a per-unit billing arrangement, calculate → approve a charge,
// prepare → approve a tenant statement, and the portfolio page. Nothing is issued, emailed or sent: charges stay
// approved (not invoiced) and statement e-mailing is off by default. Screenshots: docs/qa/hybrid-utilities-2026-10-10/.

const slowExpect = expect.configure({ timeout: 45_000 });
const SHOTS = path.resolve(__dirname, '../../../docs/qa/hybrid-utilities-2026-10-10');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const json = { headers: { Origin: BASE_URL } };

async function post(request: APIRequestContext, url: string, data: unknown) {
  const res = await request.post(url, { ...json, data });
  expect(res.ok(), `${url} → ${res.status()} ${await res.text()}`).toBe(true);
  return res.json();
}

/** The first-run guided tour sits fixed bottom-right and can cover buttons (known residual, see
 * v1-closeout-ownership-accounting-referral.spec.ts); a real user skips it first. */
async function dismissTour(page: Page) {
  const skip = page.getByRole('button', { name: 'Skip tour', exact: true }).first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await expect(skip).not.toBeVisible({ timeout: 5_000 });
  }
}

const sastDate = (msAgo: number) => new Date(Date.now() + 2 * 3_600_000 - msAgo).toISOString().slice(0, 10);

test('landlord sets up a hybrid supply, a tariff and an arrangement, then approves a charge and a tenant statement', async ({ page }) => {
  test.setTimeout(300_000);
  const { orgId } = await setUpOrg(page.request, 'hybrid-utilities');
  await enableSmartUtilitiesForTests(orgId); // off by default since migration 182
  const propertyId = await createProperty(page.request, orgId, 'Hybrid Walkthrough');
  const unitId = await createUnit(page.request, propertyId, 'Flat 1');
  const tenant = await post(page.request, '/api/v1/tenants', { orgId, fullName: 'Thandi Hybrid' });
  const lease = await post(page.request, '/api/v1/leases', { orgId, unitId, startDate: '2026-01-01', rentAmount: 6500, depositAmount: 0 });
  await post(page.request, `/api/v1/leases/${lease.lease.id}/tenants`, { tenantId: tenant.tenant.id, isPrimary: true });
  await post(page.request, `/api/v1/leases/${lease.lease.id}/activate`, {});

  // The flatlet's own electricity submeter, read twice (API, same session).
  const meter = await post(page.request, `/api/v1/properties/${propertyId}/smart-meters`, {
    utilityType: 'electricity', meterRole: 'submeter', ownership: 'private', unitId, connectivity: 'manual', meterNumber: 'FLAT1-E', measurementKind: 'consumption',
  });
  const meterId = (meter.meterId ?? meter.meter?.id) as string;
  // Readings on the SAST midnights that bound the billing range (2 days ago → today), as a monthly read would be.
  const from = sastDate(2 * 86_400_000);
  const to = sastDate(0);
  for (const [at, kwh] of [[`${from}T00:00:00+02:00`, 1000], [`${sastDate(86_400_000)}T00:00:00+02:00`, 1080], [`${to}T00:00:00+02:00`, 1150]] as const) {
    await post(page.request, `/api/v1/smart-meters/${meterId}/telemetry`, { readAt: new Date(at).toISOString(), reading: kwh });
  }

  await page.goto(`/properties/${propertyId}?tab=Utilities`);
  await slowExpect(page.getByText('Utility monitoring')).toBeVisible();
  await slowExpect(page.getByText('Supply & sources')).toBeVisible();
  await dismissTour(page);

  // --- Supply source
  const supply = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Supply & sources' }) }).last();
  await supply.getByRole('button', { name: 'Add source' }).click();
  await supply.getByLabel('Name').fill('Roof PV 8 kWp');
  await supply.getByRole('button', { name: 'Save source' }).click();
  await slowExpect(supply.getByText('Roof PV 8 kWp', { exact: true })).toBeVisible();
  await slowExpect(supply.getByText('Electricity · Roof PV 8 kWp: no meter measures this source')).toBeVisible();
  await slowExpect(supply.getByText(/^Water ·/)).toHaveCount(0); // no water meters or sources: nothing to flag
  await slowExpect(supply.getByText('not metered').first()).toBeVisible();
  await shot(page, '01-supply-and-sources');

  // --- Tariff with preview
  const billing = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Utility recharges' }) }).last();
  await billing.getByRole('button', { name: 'Add tariff' }).click();
  await billing.getByRole('combobox', { name: 'Utility' }).first().selectOption('electricity');
  await billing.getByRole('combobox', { name: 'Type' }).selectOption('flat');
  await billing.getByRole('textbox', { name: 'Name' }).fill('Illustrative flat R3,10');
  await billing.getByRole('spinbutton', { name: /Rate \(R per kWh\)/ }).fill('3.10');
  await billing.getByLabel('Effective from').fill('2026-01-01');
  await billing.getByLabel(/Preview for use of/).fill('100');
  await billing.getByRole('button', { name: 'Preview' }).click();
  await slowExpect(billing.getByText(/total R\s?310,00/)).toBeVisible();
  await shot(page, '02-tariff-preview');
  await billing.getByRole('button', { name: 'Save tariff' }).click();
  await slowExpect(billing.getByText('Illustrative flat R3,10')).toBeVisible();

  // --- Arrangement (nothing is charged without one)
  await slowExpect(billing.getByText('not set — never charged').first()).toBeVisible();
  await billing.getByRole('button', { name: 'Set arrangement' }).click();
  await billing.getByLabel('From', { exact: true }).first().fill('2026-01-01');
  await billing.getByRole('button', { name: 'Save arrangement' }).click();
  await slowExpect(billing.getByText(/Metered recharge/).first()).toBeVisible();
  await shot(page, '03-who-pays-what');

  // --- Calculate → approve
  await billing.getByLabel('From', { exact: true }).last().fill(from);
  await billing.getByLabel('To (exclusive)').fill(to);
  await billing.getByRole('button', { name: 'Calculate charges' }).click();
  await slowExpect(billing.getByText('Draft estimate').first()).toBeVisible();
  await slowExpect(billing.getByText(/^R\s?465,00$/).first()).toBeVisible(); // 150 kWh × R3,10 incl. VAT
  await billing.getByRole('button', { name: 'details' }).first().click();
  await slowExpect(billing.getByText(/check NERSA rules/)).toBeVisible();
  await shot(page, '04-draft-charge');
  await billing.getByRole('checkbox', { name: /Select Flat 1/ }).first().check();
  await billing.getByRole('button', { name: 'Approve selected' }).click();
  await slowExpect(billing.getByText('Approved', { exact: true }).first()).toBeVisible();

  // --- Tenant statement: prepared as draft, approved before the tenant can see it; e-mailing is off
  const statements = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Utility statements' }) }).last();
  await slowExpect(statements.getByText(/Emailing statements is switched off/)).toBeVisible();
  await statements.getByLabel('From').fill(from);
  await statements.getByLabel('To (exclusive)').fill(to);
  await statements.getByRole('button', { name: 'Prepare tenant statements' }).click();
  await slowExpect(statements.getByText('Thandi Hybrid · Flat 1')).toBeVisible();
  await dismissTour(page);
  await statements.getByRole('button', { name: 'approve' }).click();
  await slowExpect(statements.getByText('approved', { exact: true })).toBeVisible();
  await slowExpect(statements.getByRole('button', { name: 'send' })).toHaveCount(0);
  const pdfHref = await statements.getByRole('link', { name: 'PDF' }).first().getAttribute('href');
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  await shot(page, '05-statement-approved');

  // --- Portfolio page
  await page.goto('/utilities');
  await slowExpect(page.getByRole('link', { name: 'Hybrid Walkthrough' })).toBeVisible();
  await shot(page, '06-portfolio');

  // --- Phone width: no horizontal page scroll
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/properties/${propertyId}?tab=Utilities`);
  await slowExpect(page.getByText('Supply & sources')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot(page, '07-mobile-390px');
  expect(overflow).toBeLessThanOrEqual(1);
});
