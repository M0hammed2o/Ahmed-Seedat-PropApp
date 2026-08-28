import { test, expect } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit, getUnitStatus } from './fixtures/orgWorkflow';

// FINAL PRE-DEPLOYMENT CLOSEOUT (WORKLOG.md this date), Section 3: real browser-level
// verification of the three tenancy-creation flows (A/B/C) named in the closeout brief. Setup
// uses page.request (shares cookies with page.goto, same pattern as every other *-ui.spec.ts in
// this suite) so a single signed-in staff session drives both API scaffolding and real page
// navigations. Synthetic data only, against local/dev -- no production records touched.

test.describe('Flow A: new tenancy (application -> invite -> approve -> prepare -> activate)', () => {
  test('a brand-new applicant can be invited, apply, get approved, and the lease activated with a rent schedule', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const { orgId } = await setUpOrg(page.request, 'closeout-new-tenancy');
    const propertyId = await createProperty(page.request, orgId, 'Closeout New Tenancy Property');
    const unitId = await createUnit(page.request, propertyId, 'Unit A1');

    // === Real browser: Property -> Unit -> New Application ===
    await page.goto(`/properties/${propertyId}/units/${unitId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: '+ New application' }).click();
    await page.waitForURL(/\/applications\/new$/, { timeout: 30_000 });

    await page.getByLabel('Applicant name').fill('Closeout Applicant A');
    await page.getByLabel('Applicant email').fill('closeout-applicant-a@example.com');
    await page.getByRole('button', { name: 'Create application' }).click();
    await page.waitForURL(/\/applications\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const applicationId = page.url().split('/applications/')[1];

    // === Real browser: Invite applicant (the actual product button, not the raw API) ===
    await expect(page.getByText('Not yet invited')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Invite applicant' }).click();
    await expect(
      page.getByText(/Invitation sent\.|no real email provider is configured/),
    ).toBeVisible({ timeout: 15_000 });

    // A manual-delivery token to actually drive the public portal in this test (the UI's own
    // "Invite applicant" button always requests email delivery, and no real email provider exists
    // in this dev environment to intercept -- same substitution applicant-and-lease-prep.spec.ts
    // already uses).
    const tokenResponse = await page.request.post(
      `/api/v1/applications/${applicationId}/access-tokens`,
      { headers: { Origin: BASE_URL }, data: { deliveryChannel: 'manual' } },
    );
    expect(tokenResponse.ok()).toBe(true);
    const { accessToken } = await tokenResponse.json();

    // === Real browser: applicant portal, synthetic document, consent, submit ===
    await page.goto(`/apply/${accessToken.token}`);
    await expect(page.getByRole('heading', { name: 'Rental application' })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText(/Closeout New Tenancy Property/)).toBeVisible();

    const idRow = page.locator('li', { hasText: 'Copy of ID or passport' });
    await idRow.locator('input[type="file"]').setInputFiles({
      name: 'id.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%synthetic id document\n%%EOF'),
    });
    await expect(idRow.getByText('Uploaded — awaiting review')).toBeVisible({ timeout: 15_000 });

    await page.getByLabel(/I consent to my personal information/).check();
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByText(/Saved\. You can keep editing/)).toBeVisible({ timeout: 15_000 });

    // === Real browser: staff approves (mode defaults to 'approve'; only one submit needed) ===
    await page.goto(`/applications/${applicationId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Approve application' }).click();

    // Approval redirects straight to the lease edit screen -- "preparing" commercial terms is a
    // real, separate UI step (DecisionPanel's own comment: "commercial terms are entered next, on
    // the lease itself, via the existing lease edit screen").
    await page.waitForURL(/\/leases\/[0-9a-f-]{36}\/edit$/, { timeout: 30_000 });
    const leaseId = page.url().split('/leases/')[1]!.replace('/edit', '');

    await page.getByLabel('Start date').fill('2026-01-01');
    await page.getByLabel('Rent amount (ZAR)').fill('12000');
    await page.getByLabel('Deposit amount (ZAR)').fill('12000');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForURL(/\/leases\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    await page.request.post(`/api/v1/leases/${leaseId}/documents`, {
      headers: { Origin: BASE_URL },
      multipart: {
        file: {
          name: 'lease.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\n%mock lease document\n%%EOF'),
        },
      },
    });
    const reviewResponse = await page.request.post(`/api/v1/leases/${leaseId}/review`, {
      headers: { Origin: BASE_URL },
    });
    expect(reviewResponse.ok()).toBe(true);
    const sendResponse = await page.request.post(`/api/v1/leases/${leaseId}/send`, {
      headers: { Origin: BASE_URL },
    });
    expect(sendResponse.ok()).toBe(true);
    const confirmSignedResponse = await page.request.post(
      `/api/v1/leases/${leaseId}/confirm-signed`,
      { headers: { Origin: BASE_URL } },
    );
    expect(confirmSignedResponse.ok()).toBe(true);

    // === Real browser: activate from the lease detail page, and see the rent schedule appear ===
    await page.goto(`/leases/${leaseId}`);
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByText('Rent schedule will be generated once this lease is activated.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Activate lease' }).click({ timeout: 30_000 });

    await expect
      .poll(async () => (await getUnitStatus(page.request, unitId)), { timeout: 15_000 })
      .toBe('occupied');

    await page.reload();
    await expect(
      page.getByText('Rent schedule will be generated once this lease is activated.'),
    ).not.toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Flow B: existing tenancy (record already-signed lease)', () => {
  test('recording an existing lease skips the send/signature chain and creates the rent schedule exactly once', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'closeout-existing-tenancy');
    const propertyId = await createProperty(page.request, orgId, 'Closeout Existing Tenancy Property');
    const unitId = await createUnit(page.request, propertyId, 'Unit B1');

    // Add an existing tenant identity first (global "Add existing tenant" path, distinct from an
    // applicant flow -- there is no application here at all).
    const tenantResponse = await page.request.post('/api/v1/tenants', {
      headers: { Origin: BASE_URL },
      data: { orgId, fullName: 'Existing Tenancy Tenant' },
    });
    expect(tenantResponse.ok()).toBe(true);
    const tenant = await tenantResponse.json();

    // === Real browser: Unit -> Add lease -> Record existing lease ===
    await page.goto(`/properties/${propertyId}/units/${unitId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: '+ Add lease' }).click();
    await page.waitForURL(/\/leases\/new$/, { timeout: 15_000 });
    await page.getByText('Record existing lease').click();
    await page.waitForURL(/\/leases\/new\/existing$/, { timeout: 15_000 });

    await page.getByLabel('Primary tenant').selectOption({ label: tenant.tenant.fullName });
    // A currently-ongoing fixed term relative to "today" -- the default "Current billing period"
    // tracking anchor (this month) must fall inside [start_date, end_date) for a schedule row to
    // generate at all; an already-expired term would correctly produce zero rows.
    await page.getByLabel('Lease start date (legal)').fill('2026-01-01');
    await page.getByLabel('Expiry date').fill('2027-01-01');
    await page.getByLabel('Monthly rent (ZAR)').fill('9500');
    // Default tracking option is "Current billing period" -- matches Flow B's own spec wording.

    await page.locator('input[accept="application/pdf,.docx"]').setInputFiles({
      name: 'signed-lease.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%synthetic signed lease\n%%EOF'),
    });

    await page.getByRole('button', { name: 'Record lease' }).click();
    await page.waitForURL(/\/leases\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const leaseId = page.url().split('/leases/')[1];

    // No send/signature chain for a manual/imported lease -- Activate is directly available, no
    // "ready for review" or Prepare/Send affordance anywhere on this page.
    await expect(page.getByRole('button', { name: 'Activate lease' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Prepare lease' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Send lease' })).not.toBeVisible();

    await page.getByRole('button', { name: 'Activate lease' }).click();
    await expect
      .poll(async () => (await getUnitStatus(page.request, unitId)), { timeout: 15_000 })
      .toBe('occupied');

    // Rent schedule generation ran exactly once as part of activation: at least one row exists
    // (generate_rent_schedules_for_lease fills forward from the tracking anchor to "now + 1
    // month", so a lease anchored to the current billing period legitimately produces one row per
    // elapsed month, not necessarily a single row), and re-activating (idempotent, same as
    // property-lease-workflow.spec.ts's own coverage) must never duplicate it.
    const rentScheduleResponse = await page.request.get(`/api/v1/leases/${leaseId}/rent-schedule`);
    const rentSchedule = await rentScheduleResponse.json();
    const scheduleRows = rentSchedule.rentSchedule ?? rentSchedule.data ?? [];
    expect(scheduleRows.length).toBeGreaterThan(0);

    const reactivateResponse = await page.request.post(`/api/v1/leases/${leaseId}/activate`, {
      headers: { Origin: BASE_URL },
    });
    expect(reactivateResponse.ok()).toBe(true);
    const rentScheduleAfterReactivate = await (
      await page.request.get(`/api/v1/leases/${leaseId}/rent-schedule`)
    ).json();
    const scheduleRowsAfter =
      rentScheduleAfterReactivate.rentSchedule ?? rentScheduleAfterReactivate.data ?? [];
    expect(scheduleRowsAfter.length).toBe(scheduleRows.length);
  });
});

test.describe('Flow C: month-to-month existing tenancy', () => {
  test('recording a month-to-month lease has no expiry and activates into an ongoing state', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'closeout-m2m-tenancy');
    const propertyId = await createProperty(page.request, orgId, 'Closeout M2M Property');
    const unitId = await createUnit(page.request, propertyId, 'Unit C1');

    const tenantResponse = await page.request.post('/api/v1/tenants', {
      headers: { Origin: BASE_URL },
      data: { orgId, fullName: 'Month To Month Tenant' },
    });
    const tenant = await tenantResponse.json();

    await page.goto(`/properties/${propertyId}/units/${unitId}/leases/new/existing`);
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Primary tenant').selectOption({ label: tenant.tenant.fullName });
    await page.getByText('Month-to-month / ongoing').click();
    await expect(page.getByText('Ongoing — no expiry date')).toBeVisible();
    await page.getByLabel('Lease start date (legal)').fill('2026-01-01');
    await page.getByLabel('Monthly rent (ZAR)').fill('8000');

    await page.getByRole('button', { name: 'Record lease' }).click();
    await page.waitForURL(/\/leases\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const leaseId = page.url().split('/leases/')[1];

    // No expiry date recorded anywhere for this lease.
    const leaseCheck = await (await page.request.get(`/api/v1/leases/${leaseId}`)).json();
    expect(leaseCheck.lease.endDate).toBeFalsy();
    await expect(page.getByText('Ongoing / Month-to-month').first()).toBeVisible();

    await page.getByRole('button', { name: 'Activate lease' }).click();
    await expect
      .poll(async () => (await getUnitStatus(page.request, unitId)), { timeout: 15_000 })
      .toBe('occupied');

    const activeLeaseCheck = await (await page.request.get(`/api/v1/leases/${leaseId}`)).json();
    expect(activeLeaseCheck.lease.status).toBe('active');
    expect(activeLeaseCheck.lease.endDate).toBeFalsy();
  });
});
