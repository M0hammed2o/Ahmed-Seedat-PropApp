import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit } from './fixtures/orgWorkflow';

// Final completion + security hardening pass (WORKLOG.md this date) -- focused, single-file
// browser QA covering the NEW UI built this session (manual invoice create/edit/issue, PDF
// download) plus a couple of the tenant items from the requested letter list. Deliberately lean
// (not the full A-Q list): this machine has a documented history of Playwright/Chromium crashes
// under memory pressure across this whole engagement, and free memory was already low (~1.9GB)
// before this run started. Kept to what fits in one serial, single-worker run.

test.setTimeout(150_000);

async function createTenant(
  request: APIRequestContext,
  orgId: string,
  fullName: string,
  extra?: { email?: string; phone?: string },
): Promise<string> {
  const response = await request.post('/api/v1/tenants', {
    headers: { Origin: BASE_URL },
    data: { orgId, fullName, ...extra },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return body.tenant.id as string;
}

async function createManualLease(
  request: APIRequestContext,
  orgId: string,
  unitId: string,
  rentAmount: number,
): Promise<string> {
  const response = await request.post('/api/v1/leases', {
    headers: { Origin: BASE_URL },
    data: { orgId, unitId, startDate: '2026-01-01', rentAmount, depositAmount: 0 },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return body.lease.id as string;
}

async function assignTenantAndActivate(
  request: APIRequestContext,
  leaseId: string,
  tenantId: string,
): Promise<void> {
  const assign = await request.post(`/api/v1/leases/${leaseId}/tenants`, {
    headers: { Origin: BASE_URL },
    data: { tenantId, isPrimary: true },
  });
  expect(assign.ok()).toBe(true);
  const activate = await request.post(`/api/v1/leases/${leaseId}/activate`, {
    headers: { Origin: BASE_URL },
  });
  expect(activate.ok()).toBe(true);
}

async function setUpTenantedUnit(page: Page, label: string, tenantName: string) {
  const { orgId } = await setUpOrg(page.request, label);
  const propertyId = await createProperty(page.request, orgId, 'Manual Invoice QA Property');
  const unitId = await createUnit(page.request, propertyId, '101');
  const tenantId = await createTenant(page.request, orgId, tenantName);
  const leaseId = await createManualLease(page.request, orgId, unitId, 9000);
  await assignTenantAndActivate(page.request, leaseId, tenantId);
  return { orgId, propertyId, unitId, tenantId, leaseId };
}

test.describe('A. Internal tenant creation', () => {
  test('creating an internal tenant with email shows Not invited, no invitation UI', async ({ page }) => {
    const { orgId } = await setUpOrg(page.request, 'qa-internal-tenant-not-invited');
    await page.goto('/tenants/new');
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Full name').fill('QA Not Invited Tenant');
    await page.getByRole('textbox', { name: 'Email' }).fill('qa-not-invited@test.propertyvault.example');
    await expect(page.getByRole('radio', { name: /Manage internally only/i })).toBeChecked();
    await page.getByRole('button', { name: 'Create tenant' }).click();

    await page.waitForURL(/\/tenants\/[a-f0-9-]+$/, { timeout: 30_000 });
    await expect(page.getByText(/Portal:\s*Not invited/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Invitation pending/i)).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Resend/i })).not.toBeVisible();
    void orgId;
  });
});

test.describe('E-K. Manual invoice: cascade, line items, draft, edit, issue, blocked post-issue edit', () => {
  test('full manual invoice lifecycle through the real UI', async ({ page }) => {
    const { propertyId: _p, unitId: _u, tenantId: _t } = await setUpTenantedUnit(
      page,
      'qa-manual-invoice-lifecycle',
      'QA Manual Invoice Tenant',
    );

    // E/F: Accounting -> Invoices -> Create invoice, Property -> Unit -> Tenant cascade.
    await page.goto('/accounting/invoices/new');
    await page.waitForLoadState('networkidle');
    // getByLabel is case-insensitive substring matching by default, and each select's computed
    // accessible name includes its own current placeholder-option text (e.g. the Unit select's
    // name literally becomes "Unit" + "Choose a property first") -- "Property" then ambiguously
    // matches both selects. Found by running this, not assumed safe. Fixed by using the selects'
    // fixed DOM order (Property, Unit, Tenant) instead, same fix class as this repo's other specs.
    const selects = page.locator('select');
    await selects.nth(0).selectOption({ label: 'Manual Invoice QA Property' });
    await selects.nth(1).selectOption({ label: '101' });
    await selects.nth(2).selectOption({ label: 'QA Manual Invoice Tenant' });
    await page.getByLabel('Due date').fill('2026-09-15');

    // G: two line items.
    const rows = page.locator('div.grid.grid-cols-\\[1fr_5rem_6rem_5rem_auto\\]');
    await rows.nth(0).locator('input').nth(0).fill('Water');
    await rows.nth(0).locator('input').nth(2).fill('250');
    await page.getByRole('button', { name: '+ Add line' }).click();
    await rows.nth(1).locator('input').nth(0).fill('Parking');
    await rows.nth(1).locator('input').nth(2).fill('300');

    // Final pages this session (ManualInvoiceForm/invoice detail) use formatSouthAfricanNumber()
    // directly (no forced decimals) -- distinct from the older invoicing-workflow.spec.ts pages,
    // which use a 2-decimal formatMoney(). Confirmed by reading the actual rendered text, not
    // assumed from the other spec's own currency() helper.
    await expect(page.getByText('Total: R550')).toBeVisible();

    // H: save as draft.
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await page.waitForURL(/\/accounting\/invoices\/[a-f0-9-]+$/, { timeout: 30_000 });
    await expect(page.getByText('Draft -- not yet issued')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('R550').first()).toBeVisible();

    // I: edit the draft.
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.waitForURL(/\/edit$/, { timeout: 15_000 });
    const editRows = page.locator('div.grid.grid-cols-\\[1fr_5rem_6rem_5rem_auto\\]');
    await editRows.nth(0).locator('input').nth(2).fill('275');
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await page.waitForURL(/\/accounting\/invoices\/[a-f0-9-]+$/, { timeout: 30_000 });
    await expect(page.getByText('R575').first()).toBeVisible({ timeout: 15_000 });

    // J: issue.
    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await expect(page.getByText(/^Issued/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Edit' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Issue invoice' })).not.toBeVisible();

    // K: attempting to reach the edit page directly after issue is blocked (redirected back).
    const currentUrl = page.url();
    await page.goto(`${currentUrl}/edit`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/edit');

    // M: a real server-generated PDF actually downloads, not just window.print().
    const invoiceId = currentUrl.split('/').pop()!;
    const pdfResponse = await page.request.get(`/api/v1/invoices/${invoiceId}/pdf`);
    expect(pdfResponse.ok()).toBe(true);
    expect(pdfResponse.headers()['content-type']).toContain('application/pdf');
    const pdfBytes = await pdfResponse.body();
    expect(pdfBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
