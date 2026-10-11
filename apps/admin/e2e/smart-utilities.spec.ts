import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit, enableSmartUtilitiesForTests } from './fixtures/orgWorkflow';

// Smart Utilities browser walk-through (docs/SMART_UTILITIES_PROGRESS.md): the Utilities tab, the
// Add Smart Meter wizard + catalogue honesty labels, a manual reading and its review, the
// municipal template preview + approval, and a phone-width layout check. Screenshots are kept in
// docs/qa/smart-utilities-2026-10-10/ as evidence. Nothing here sends email or uploads files.

// Dev-mode Turbopack compiles each new route on first request (observed >15 s on this machine).
const slowExpect = expect.configure({ timeout: 45_000 });

const SHOTS = path.resolve(__dirname, '../../../docs/qa/smart-utilities-2026-10-10');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

async function openUtilities(page: Page, propertyId: string) {
  await page.goto(`/properties/${propertyId}`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Utilities', exact: true }).or(page.getByRole('tab', { name: 'Utilities', exact: true })).first().click();
  await slowExpect(page.getByText('Utility monitoring')).toBeVisible({ timeout: 30_000 });
}

test('landlord adds a meter from the catalogue, records and reviews a reading, and approves the municipal email', async ({ page }) => {
  test.setTimeout(240_000);
  const { orgId } = await setUpOrg(page.request, 'smart-utilities');
  await enableSmartUtilitiesForTests(orgId); // off by default since migration 182
  const propertyId = await createProperty(page.request, orgId, 'Utilities Walkthrough');
  await createUnit(page.request, propertyId, 'Flat 1');

  await openUtilities(page, propertyId);
  await shot(page, '01-utilities-tab-empty');

  // --- Add Smart Meter wizard
  await page.getByRole('button', { name: 'Add meter' }).click();
  await page.getByRole('button', { name: 'Next: choose meter' }).click();
  const manual = page.locator('li').filter({ hasText: 'Traditional water meter (manual readings + photo)' });
  await slowExpect(manual.getByText('Verified and ready')).toBeVisible();
  const milesight = page.locator('li').filter({ hasText: 'Milesight EM300-DI' });
  await slowExpect(milesight.getByText('Supported — awaiting hardware testing')).toBeVisible();
  await slowExpect(milesight.getByText(/R 1\s?350,00 incl VAT/)).toBeVisible();
  await shot(page, '02-catalogue');
  await page.getByLabel('Also show meters that need supplier approval').check();
  await slowExpect(page.getByText('Requires supplier approval').first()).toBeVisible();
  await shot(page, '03-catalogue-all-statuses');
  await manual.getByRole('button', { name: 'I have this meter' }).click();
  await page.getByLabel('Meter number (as on the meter / account)').fill('TSH-W-0001');
  await page.getByLabel('Location').fill('Boundary box, left of gate');
  await shot(page, '04-configure-manual-meter');
  await page.getByRole('button', { name: 'Save meter' }).click();
  await slowExpect(page.getByText(/Meter saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await slowExpect(page.getByText('Boundary box, left of gate')).toBeVisible();

  // --- A manual reading (API, same session) then review it in the UI
  const overview = await (await page.request.get(`/api/v1/properties/${propertyId}/smart-utility`)).json();
  const meterId = overview.meters[0].id as string;
  for (const [h, kl] of [[48, 1010], [1, 1035.5]] as const) {
    const r = await page.request.post(`/api/v1/smart-meters/${meterId}/telemetry`, {
      headers: { Origin: BASE_URL },
      data: { readAt: new Date(Date.now() - h * 3_600_000).toISOString(), reading: kl },
    });
    expect(r.status()).toBe(201);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Utilities', exact: true }).or(page.getByRole('tab', { name: 'Utilities', exact: true })).first().click();
  await page.getByRole('button', { name: 'History' }).first().click();
  await slowExpect(page.getByText('Unverified').first()).toBeVisible();
  await shot(page, '05-reading-history-unverified');
  await page.getByRole('button', { name: 'Verify' }).first().click();
  await slowExpect(page.getByText('Verified', { exact: true }).first()).toBeVisible();
  await shot(page, '06-reading-verified');
  await page.getByRole('button', { name: 'Close' }).first().click();

  // --- Municipal settings, recipient, preview, approval
  const muni = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Monthly municipal readings' }) }).last();
  await muni.getByRole('combobox', { name: /^Municipality/ }).selectOption('tshwane');
  await muni.getByRole('textbox', { name: /^Municipal account/ }).fill('5000000000');
  await muni.getByLabel(/Custom message/).fill('Gate code available on request.');
  await muni.getByRole('button', { name: 'Save settings' }).click();
  await slowExpect(muni.getByText(/^Saved/)).toBeVisible();
  await muni.getByRole('textbox', { name: /^Email/ }).fill('agent@example.com');
  await muni.getByLabel(/I authorise Proplyst to email this address/).check();
  await muni.getByRole('button', { name: 'Add recipient' }).click();
  await slowExpect(muni.getByText('agent@example.com')).toBeVisible();
  await muni.getByRole('button', { name: 'Preview saved email' }).click();
  const preview = page.getByRole('region', { name: 'Email preview' });
  await slowExpect(preview.getByText('Exactly what will be sent')).toBeVisible();
  await slowExpect(preview.getByText(/5000000000/).first()).toBeVisible();
  await slowExpect(preview.getByText('Not approved')).toBeVisible();
  // The preview covers the period the next send covers, so today's reading appears (not "—").
  await slowExpect(preview.getByText(/Current reading: 1\s?035[,.]5 kL/)).toBeVisible();
  await slowExpect(preview.getByText(/have no reading for this period/)).toHaveCount(0);
  await shot(page, '07-municipal-preview');
  await preview.getByRole('button', { name: 'Approve this email' }).click();
  await slowExpect(preview.getByText('Approved', { exact: true })).toBeVisible();
  await slowExpect(preview.getByRole('button', { name: 'Enable scheduled sending' })).toBeVisible();
  await shot(page, '08-municipal-approved');

  // --- Phone width: no horizontal page scroll on the Utilities tab
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot(page, '09-mobile-390px');
  expect(overflow).toBeLessThanOrEqual(1);
});
