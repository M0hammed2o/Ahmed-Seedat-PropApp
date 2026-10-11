import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit } from './fixtures/orgWorkflow';

// Production-readiness browser checks (docs/UTILITIES_FINAL_TEST_RESULTS.md): a manual reading WITH a photo and its
// review + evidence PDF, the consumption graph, municipal approval withdrawn by a content change, a refused invalid
// tariff shown as a clear error, and desktop / tablet / phone layouts without horizontal scrolling. Mock e-mail and
// mock malware scanner only; nothing is sent.

const slowExpect = expect.configure({ timeout: 45_000 });
const SHOTS = path.resolve(__dirname, '../../../docs/qa/utilities-readiness-2026-10-11');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

// 1×1 PNG (a stand-in for a meter photo).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

async function dismissTour(page: Page) {
  const skip = page.getByRole('button', { name: 'Skip tour', exact: true }).first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await expect(skip).not.toBeVisible({ timeout: 5_000 });
  }
}

async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test('readings with photo evidence, graphs, approval invalidation, error display and layouts', async ({ page }) => {
  test.setTimeout(360_000);
  const { orgId } = await setUpOrg(page.request, 'utilities-readiness');
  const propertyId = await createProperty(page.request, orgId, 'Readiness Court');
  await createUnit(page.request, propertyId, 'Flat 1');

  // A municipal water meter via the API (the wizard itself is covered by smart-utilities.spec.ts).
  const created = await page.request.post(`/api/v1/properties/${propertyId}/smart-meters`, {
    headers: { Origin: BASE_URL },
    data: { utilityType: 'water', meterRole: 'main', ownership: 'municipal', connectivity: 'manual', meterNumber: 'RC-W-1', location: 'Gate box' },
  });
  expect(created.status()).toBe(201);
  const meterId = (await created.json()).meterId as string;
  // An earlier reading two days ago so the graph has two points.
  const earlier = await page.request.post(`/api/v1/smart-meters/${meterId}/telemetry`, {
    headers: { Origin: BASE_URL },
    data: { readAt: new Date(Date.now() - 48 * 3_600_000).toISOString(), reading: 1000 },
  });
  expect(earlier.status()).toBe(201);

  await page.goto(`/properties/${propertyId}?tab=Utilities`);
  await slowExpect(page.getByText('Utility monitoring')).toBeVisible();
  await dismissTour(page);

  // --- Manual reading with a photo, through the UI
  await page.getByRole('button', { name: 'Reading', exact: true }).first().click();
  await page.getByLabel(/Reading on the dial/).fill('1012.5');
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'meter.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Save reading' }).click();
  await slowExpect(page.getByText('Record a reading')).toHaveCount(0);
  await page.getByRole('button', { name: 'History' }).first().click();
  await slowExpect(page.getByText('Photo').first()).toBeVisible();
  await slowExpect(page.getByText('Unverified').first()).toBeVisible();
  await shot(page, '01-reading-with-photo');
  // Sole member of the organisation: allowed to verify, and the record says so.
  await page.getByRole('button', { name: 'Verify' }).first().click();
  await slowExpect(page.getByText(/Self-verified/).first()).toBeVisible();
  const evidenceHref = await page.getByRole('link', { name: 'PDF' }).first().getAttribute('href');
  const evidence = await page.request.get(evidenceHref!);
  expect(evidence.headers()['content-type']).toContain('application/pdf');
  await shot(page, '02-reading-verified-evidence');
  await page.getByRole('button', { name: 'Close' }).first().click();

  // --- Consumption graph (two readings → a chart, not "Not enough readings")
  await page.reload();
  await dismissTour(page);
  await slowExpect(page.getByText(/Water use \(kL\)/).first()).toBeVisible();
  await shot(page, '03-consumption-graph');

  // --- Invalid tariff: refused with a readable message
  const billing = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Utility recharges' }) }).last();
  await billing.getByRole('button', { name: 'Add tariff' }).click();
  await billing.getByRole('textbox', { name: 'Name' }).fill('FICTIONAL broken blocks');
  await billing.getByRole('spinbutton', { name: /Rate \(R per kL\)/ }).first().fill('20');
  await billing.getByRole('button', { name: 'Add block' }).click();
  await billing.getByRole('spinbutton', { name: /Block 1: up to/ }).fill('15');
  await billing.getByRole('spinbutton', { name: /Rate \(R per kL\)/ }).nth(1).fill('10');
  await billing.getByRole('button', { name: 'Add block' }).click();
  await billing.getByRole('spinbutton', { name: /Block 2: up to/ }).fill('6'); // descending: invalid
  await billing.getByRole('spinbutton', { name: /Rate \(R per kL\)/ }).nth(2).fill('30');
  await billing.getByRole('button', { name: 'Save tariff' }).click();
  await slowExpect(billing.getByRole('alert').first()).toBeVisible();
  await shot(page, '04-invalid-tariff-error');

  // --- Municipal: approve, then change the content → approval withdrawn
  const muni = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Monthly municipal readings' }) }).last();
  await muni.getByRole('combobox', { name: /^Municipality/ }).selectOption('tshwane');
  await muni.getByRole('textbox', { name: /^Municipal account/ }).fill('5000000001');
  await muni.getByRole('button', { name: 'Save settings' }).click();
  await slowExpect(muni.getByText(/^Saved/)).toBeVisible();
  await muni.getByRole('textbox', { name: /^Email/ }).fill('readiness-agent@example.com');
  await muni.getByLabel(/I authorise Proplyst to email this address/).check();
  await muni.getByRole('button', { name: 'Add recipient' }).click();
  await slowExpect(muni.getByText('readiness-agent@example.com')).toBeVisible();
  await muni.getByRole('button', { name: 'Preview saved email' }).click();
  const preview = page.getByRole('region', { name: 'Email preview' });
  await preview.getByRole('button', { name: 'Approve this email' }).click();
  await slowExpect(preview.getByText('Approved', { exact: true })).toBeVisible();
  await muni.getByLabel(/Custom message/).fill('Changed after approval.');
  await muni.getByRole('button', { name: 'Save settings' }).click();
  await slowExpect(muni.getByText(/approval was withdrawn/)).toBeVisible();
  await muni.getByRole('button', { name: 'Preview saved email' }).click();
  await slowExpect(page.getByRole('region', { name: 'Email preview' }).getByText('Not approved')).toBeVisible();
  await shot(page, '05-approval-withdrawn');

  // --- Layouts: desktop, tablet, phone — Utilities tab and the portfolio page
  for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 768, 1024], ['phone', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/properties/${propertyId}?tab=Utilities`);
    await slowExpect(page.getByText('Utility monitoring')).toBeVisible();
    expect(await noHorizontalScroll(page), `${name} utilities tab`).toBeLessThanOrEqual(1);
    await shot(page, `06-${name}-utilities-tab`);
    await page.goto('/utilities');
    await slowExpect(page.getByRole('link', { name: 'Readiness Court' })).toBeVisible();
    expect(await noHorizontalScroll(page), `${name} portfolio`).toBeLessThanOrEqual(1);
    await shot(page, `07-${name}-portfolio`);
  }
});
