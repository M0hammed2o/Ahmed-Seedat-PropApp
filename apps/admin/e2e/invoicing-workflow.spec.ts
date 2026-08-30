import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit } from './fixtures/orgWorkflow';

// Final local hardening pass (WORKLOG.md this date), Objective 2, workflows I-M: real
// browser-driven QA for the landlord rent-invoicing page and its underlying issuance/payment/send
// plumbing, against a real local dev server + real local Supabase. Never a real external
// recipient -- tenant emails, where used, are the same non-resolving @test.propertyvault.example
// convention every fixture in this repo already uses (createConfirmedTestUser), and
// dispatchEmail()/dispatchWhatsApp() no-op safely for a tenant with no contact info at all.

test.setTimeout(150_000);

// Matches packages/utils/src/currency.ts's formatSouthAfricanNumber() exactly: thousands are
// grouped with a NON-BREAKING space (U+00A0), never a comma -- confirmed by reading that function
// directly after an earlier, wrong "R12,000" literal assertion failed against the real page.
function currency(amount: number): string {
  return `R${amount.toLocaleString('en-ZA').replace(/,/g, String.fromCharCode(160))}`;
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

async function createTenant(
  request: APIRequestContext,
  orgId: string,
  fullName: string,
  email?: string,
): Promise<string> {
  const response = await request.post('/api/v1/tenants', {
    headers: { Origin: BASE_URL },
    data: { orgId, fullName, ...(email ? { email } : {}) },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return body.tenant.id as string;
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

/** activate_lease() calls generate_rent_schedules_for_lease() itself -- this just finds the
 * schedule it produced for a given org (each test's org has exactly one lease/schedule set,
 * so the org-scoped, still-pending list is unambiguous). */
async function findPendingRentScheduleId(request: APIRequestContext, orgId: string): Promise<string> {
  const response = await request.get(`/api/v1/rent-schedules?org_id=${orgId}&status=pending`);
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.rentSchedules.length).toBeGreaterThan(0);
  return body.rentSchedules[0].id as string;
}

async function issueInvoice(request: APIRequestContext, rentScheduleId: string): Promise<string> {
  const response = await request.post(`/api/v1/rent-schedules/${rentScheduleId}/invoice`, {
    headers: { Origin: BASE_URL },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return body.invoice.id as string;
}

async function recordAndMatchPayment(
  request: APIRequestContext,
  orgId: string,
  rentScheduleId: string,
  amount: number,
): Promise<void> {
  const bankAccountResponse = await request.post('/api/v1/bank-accounts', {
    headers: { Origin: BASE_URL },
    data: { orgId, accountClass: 'business', bankName: 'QA Test Bank' },
  });
  expect(bankAccountResponse.ok()).toBe(true);
  const bankAccount = await bankAccountResponse.json();

  const txnResponse = await request.post('/api/v1/bank-transactions', {
    headers: { Origin: BASE_URL },
    data: { bankAccountId: bankAccount.bankAccount.id, transactionDate: '2026-09-02', amount },
  });
  expect(txnResponse.ok()).toBe(true);
  const txn = await txnResponse.json();

  const matchResponse = await request.post(`/api/v1/bank-transactions/${txn.bankTransaction.id}/confirm-match`, {
    headers: { Origin: BASE_URL },
    data: { rentScheduleId },
  });
  expect(matchResponse.ok()).toBe(true);
}

/** Full setup used by most of these tests: org -> property -> unit -> tenant -> active lease ->
 * generated rent schedule -> issued invoice. Returns everything a test might need to assert on. */
async function setUpIssuedInvoice(
  page: Page,
  label: string,
  options: { tenantName: string; tenantEmail?: string; rentAmount?: number },
) {
  const { orgId } = await setUpOrg(page.request, label);
  const propertyId = await createProperty(page.request, orgId, 'Musgrave Heights');
  const unitId = await createUnit(page.request, propertyId, '601');
  const tenantId = await createTenant(page.request, orgId, options.tenantName, options.tenantEmail);
  const leaseId = await createManualLease(page.request, orgId, unitId, options.rentAmount ?? 12000);
  await assignTenantAndActivate(page.request, leaseId, tenantId);
  const rentScheduleId = await findPendingRentScheduleId(page.request, orgId);
  const invoiceId = await issueInvoice(page.request, rentScheduleId);
  return { orgId, propertyId, unitId, tenantId, leaseId, rentScheduleId, invoiceId };
}

test.describe('I. Landlord invoices page', () => {
  test('the invoices list shows every required column, and filters/search work', async ({ page }) => {
    const { propertyId, unitId, tenantId } = await setUpIssuedInvoice(page, 'qa-invoices-list', {
      tenantName: 'John Smith',
    });

    await page.goto('/accounting/invoices');
    await page.waitForLoadState('networkidle');

    // Scoped to the real <table> throughout -- property/unit/tenant names also appear as
    // <option> text in the filter selects above it (same values, real ambiguity), so an
    // unscoped page.getByText(...) matches both and fails Playwright's strict mode.
    const table = page.locator('table');
    await expect(table.getByText(/^INV-\d{6}$/)).toBeVisible({ timeout: 30_000 });
    await expect(table.getByText('John Smith')).toBeVisible();
    await expect(table.getByText('Musgrave Heights')).toBeVisible();
    await expect(table.getByText('601')).toBeVisible();
    await expect(table.getByText(/Rent$/)).toBeVisible();
    await expect(table.getByText(currency(12000)).first()).toBeVisible();

    // Search by tenant name.
    await page.getByPlaceholder('Search invoice # or tenant').fill('John Smith');
    await expect(table.getByText('John Smith')).toBeVisible();
    await page.getByPlaceholder('Search invoice # or tenant').fill('Nobody Matches This');
    await expect(page.getByText('No invoices match this filter')).toBeVisible();
    await page.getByPlaceholder('Search invoice # or tenant').fill('');

    // Property/unit/tenant/status filters -- each select is identified by its own default option.
    const propertySelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'All properties' }) });
    await propertySelect.selectOption({ label: 'Musgrave Heights' });
    await expect(table.getByText('John Smith')).toBeVisible();

    const unitSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'All units' }) });
    await unitSelect.selectOption({ label: '601' });
    await expect(table.getByText('John Smith')).toBeVisible();

    const tenantSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'All tenants' }) });
    await tenantSelect.selectOption({ label: 'John Smith' });
    await expect(table.getByText('John Smith')).toBeVisible();

    const statusSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'All statuses' }) });
    await statusSelect.selectOption('Issued');
    await expect(table.getByText('John Smith')).toBeVisible();
    await statusSelect.selectOption('Paid');
    await expect(page.getByText('No invoices match this filter')).toBeVisible();

    void propertyId;
    void unitId;
    void tenantId;
  });
});

test.describe('J. Partial payment', () => {
  test('a R8,000 payment against a R12,000 invoice shows Paid R8,000 / Balance R4,000 / Partially paid, and the rent-schedule source agrees', async ({
    page,
  }) => {
    const { orgId, rentScheduleId } = await setUpIssuedInvoice(page, 'qa-partial-payment', {
      tenantName: 'Partial Payment Tenant',
      rentAmount: 12000,
    });

    await recordAndMatchPayment(page.request, orgId, rentScheduleId, 8000);

    await page.goto('/accounting/invoices');
    await page.waitForLoadState('networkidle');
    const row = page.locator('tr', { hasText: 'Partial Payment Tenant' });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText(currency(8000))).toBeVisible();
    await expect(row.getByText(currency(4000))).toBeVisible();
    await expect(row.getByText('Partially paid')).toBeVisible();

    // No competing source of truth: the underlying rent_schedule itself must also read 'partial'.
    const scheduleResponse = await page.request.get(`/api/v1/rent-schedules?org_id=${orgId}`);
    const scheduleBody = await scheduleResponse.json();
    const schedule = scheduleBody.rentSchedules.find((s: { id: string }) => s.id === rentScheduleId);
    expect(schedule.status).toBe('partial');
  });
});

test.describe('K. Internal tenant invoice', () => {
  test('an internal tenant with no email can be invoiced with no crash, and Send invoice gives a clear cannot-send message', async ({
    page,
  }) => {
    const { invoiceId } = await setUpIssuedInvoice(page, 'qa-internal-tenant-invoice', {
      tenantName: 'Internal Tenant No Email',
    });

    await page.goto('/accounting/invoices');
    await page.waitForLoadState('networkidle');
    const row = page.locator('tr', { hasText: 'Internal Tenant No Email' });
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.getByRole('button', { name: 'Send invoice' }).click();
    await expect(row.getByText(/no email address on file/i)).toBeVisible({ timeout: 15_000 });

    // The invoice itself remains perfectly valid -- no fake "sent" state, no crash.
    await expect(row.getByText(currency(12000)).first()).toBeVisible();
    await expect(row).toBeVisible();
    void invoiceId;
  });
});

test.describe('L. Portal tenant invoice (no auto-send, explicit send only)', () => {
  test('issuing an invoice never sends it automatically; only the explicit Send invoice action does, and it never uses a real external recipient', async ({
    page,
  }) => {
    const { invoiceId } = await setUpIssuedInvoice(page, 'qa-portal-tenant-invoice', {
      tenantName: 'Portal Tenant',
      tenantEmail: `qa-portal-tenant-${Date.now()}@test.propertyvault.example`,
    });

    await page.goto('/accounting/invoices');
    await page.waitForLoadState('networkidle');
    const row = page.locator('tr', { hasText: 'Portal Tenant' });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Immediately after issuance, "Send invoice" is still offered -- proving nothing was sent yet.
    await expect(row.getByRole('button', { name: 'Send invoice' })).toBeVisible();
    await expect(row.getByText('Sent')).not.toBeVisible();

    // Only the explicit click sends it.
    await row.getByRole('button', { name: 'Send invoice' }).click();
    await expect(row.getByText('Sent')).toBeVisible({ timeout: 15_000 });
    await expect(row.getByRole('button', { name: 'Send invoice' })).not.toBeVisible();

    void invoiceId;
  });
});

test.describe('M. SaaS invoice separation', () => {
  test('the landlord invoices page never shows SaaS subscription invoices -- only this org\'s own rent invoices, using the rent-invoice number format', async ({
    page,
  }) => {
    await setUpIssuedInvoice(page, 'qa-saas-separation', { tenantName: 'Separation Tenant' });

    await page.goto('/accounting/invoices');
    await page.waitForLoadState('networkidle');
    const table = page.locator('table');
    await expect(table.getByText('Separation Tenant')).toBeVisible({ timeout: 30_000 });

    // Every visible invoice number is INV-###### (rent invoices) -- never PLY-YYYY-###### (the
    // separate subscription_invoices numbering format, ACCOUNTING.md's own documented split).
    const invoiceNumberCells = await page.getByText(/^(INV|PLY)-/).allTextContents();
    expect(invoiceNumberCells.length).toBeGreaterThan(0);
    for (const cell of invoiceNumberCells) {
      expect(cell.startsWith('PLY-')).toBe(false);
    }

    // The table itself never renders a subscription-billing row -- the page's own subtitle
    // legitimately says the word "subscription" once, to explain the split, which is real UX and
    // not a violation; the real proof is that no invoice ROW carries that content.
    await expect(table.getByText(/subscription/i)).not.toBeVisible();
  });
});
