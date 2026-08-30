import { test, expect, type APIRequestContext } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit, getUnitStatus } from './fixtures/orgWorkflow';

// Each of these tests does several sequential real navigations, some against a route Turbopack
// hasn't compiled yet on a freshly (re)started dev server -- empirically observed to take 15-20s
// on its own under this session's real system memory pressure. The config's own 60s default is
// too tight for that plus everything else in one of these multi-step tests.
test.setTimeout(150_000);

// Final local hardening pass (WORKLOG.md this date), Objective 2, workflows A-H: real
// browser-driven QA for the property/unit editing and archive/delete lifecycle UI built in Phase
// H, against a real local dev server + real local Supabase. API-driven for setup/multi-step state
// (lease creation/tenant assignment/activation has no shorter UI path -- same "API setup, UI
// assertions" split property-workflow-ui.spec.ts already established), real page.goto/click/fill
// for every action the task brief itself describes as a click.

async function createManualLease(
  request: APIRequestContext,
  orgId: string,
  unitId: string,
  rentAmount = 9000,
): Promise<string> {
  const response = await request.post('/api/v1/leases', {
    headers: { Origin: BASE_URL },
    data: { orgId, unitId, startDate: '2026-01-01', rentAmount, depositAmount: 0 },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return body.lease.id as string;
}

async function createTenant(request: APIRequestContext, orgId: string, fullName: string): Promise<string> {
  const response = await request.post('/api/v1/tenants', {
    headers: { Origin: BASE_URL },
    data: { orgId, fullName },
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

/** Gives a property "material history" the same way propertyLifecycle.test.ts's RPC-level suite
 * does -- a unit (audit_events.property_id then permanently references it, empirically proven
 * earlier this engagement), which is enough on its own to block hard delete without needing an
 * active lease too. */
async function createUnitToGiveHistory(request: APIRequestContext, propertyId: string): Promise<void> {
  await createUnit(request, propertyId, 'History Unit');
}

test.describe('A. Property edit', () => {
  test('editing nickname/address/notes preserves the property id and its units, and the changes are visible', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'qa-property-edit');
    const propertyId = await createProperty(page.request, orgId, 'Musgrave Heights');
    const unitId = await createUnit(page.request, propertyId, '601');

    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Edit property' }).click();
    await page.waitForURL(`**/properties/${propertyId}/edit`);

    await page.getByLabel('Property name').fill('Musgrave Heights (Renamed)');
    await page.getByLabel('Address line 1').fill('42 Renamed Street');
    await page.getByLabel('Notes').fill('QA edit note');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForURL(`**/properties/${propertyId}`);

    const getResponse = await page.request.get(`/api/v1/properties/${propertyId}`);
    const body = await getResponse.json();
    expect(body.property.id).toBe(propertyId);
    expect(body.property.nickname).toBe('Musgrave Heights (Renamed)');
    expect(body.property.addressLine1).toBe('42 Renamed Street');
    expect(body.property.notes).toBe('QA edit note');

    // Units unaffected by the edit.
    const unitsResponse = await page.request.get(`/api/v1/properties/${propertyId}/units`);
    const unitsBody = await unitsResponse.json();
    expect(unitsBody.units.map((u: { id: string }) => u.id)).toContain(unitId);
  });
});

test.describe('B. Empty property hard delete', () => {
  test('a genuinely unused property can be permanently deleted by the principal via typed confirmation, and unrelated properties are untouched', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'qa-empty-property-delete');
    const propertyId = await createProperty(page.request, orgId, 'Test Property');
    const unrelatedId = await createProperty(page.request, orgId, 'Unrelated Property');
    const unrelatedUnitId = await createUnit(page.request, unrelatedId, 'Unrelated Unit');

    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Delete permanently' }).click();

    await page.getByLabel(/Type .* to confirm/i).fill('Test Property');
    await page
      .locator('div', { hasText: 'This permanently deletes Test Property' })
      .getByRole('button', { name: 'Delete permanently' })
      .click();

    await page.waitForURL('**/properties');
    const listResponse = await page.request.get('/api/v1/properties');
    expect(listResponse.ok()).toBe(true);

    const goneCheck = await page.request.get(`/api/v1/properties/${propertyId}`);
    expect(goneCheck.status()).toBe(404);

    // Unrelated property (and its unit) completely untouched.
    const unrelatedCheck = await page.request.get(`/api/v1/properties/${unrelatedId}`);
    expect(unrelatedCheck.ok()).toBe(true);
    const unrelatedUnitCheck = await page.request.get(`/api/v1/units/${unrelatedUnitId}`);
    expect(unrelatedUnitCheck.ok()).toBe(true);
  });
});

test.describe('C. Property with history', () => {
  test('a property with a unit cannot be hard-deleted, only archived, and the real blocker reason is shown', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'qa-property-history');
    const propertyId = await createProperty(page.request, orgId, 'Historical Property');
    await createUnitToGiveHistory(page.request, propertyId);

    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');

    // Give the eligibility check (fired client-side on mount) time to resolve.
    await expect(page.getByText(/historical activity and cannot be permanently deleted/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Delete permanently' })).not.toBeVisible();
    // The exact reason (not just the generic sentence) is listed.
    await expect(page.getByText(/unit\(s\) still recorded on this property/i)).toBeVisible();

    // Archive is still offered and works.
    await expect(page.getByRole('button', { name: 'Archive property' })).toBeVisible();
  });
});

test.describe('D. Active lease archive block', () => {
  test('archiving a property with an active lease is blocked with a specific actionable error, and nothing is mutated', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'qa-active-lease-archive-block');
    const propertyId = await createProperty(page.request, orgId, 'Musgrave Heights');
    const unitId = await createUnit(page.request, propertyId, '601');
    const leaseId = await createManualLease(page.request, orgId, unitId);
    const tenantId = await createTenant(page.request, orgId, 'Active Lease QA Tenant');
    await assignTenantAndActivate(page.request, leaseId, tenantId);
    expect(await getUnitStatus(page.request, unitId)).toBe('occupied');

    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Archive property' }).click();

    await expect(page.getByText(/cannot be archived because Unit 601 has an active lease/i)).toBeVisible({
      timeout: 30_000,
    });

    // No mutation: property still active, lease still active, unit still occupied.
    const propertyCheck = await page.request.get(`/api/v1/properties/${propertyId}`);
    expect((await propertyCheck.json()).property.status).toBe('active');
    const leaseCheck = await page.request.get(`/api/v1/leases/${leaseId}`);
    expect((await leaseCheck.json()).lease.status).toBe('active');
    expect(await getUnitStatus(page.request, unitId)).toBe('occupied');
  });
});

test.describe('E. Property archive + restore', () => {
  test('archiving hides a property from the default Active list, keeps it under Archived/All, keeps its detail/history accessible, and restore returns it to Active', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'qa-property-archive-restore');
    const propertyId = await createProperty(page.request, orgId, 'Historical Property');
    await createUnit(page.request, propertyId, '101');

    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Archive property' }).click();
    await expect(page.getByRole('button', { name: 'Restore property' })).toBeVisible({ timeout: 30_000 });

    // Default (Active) listing no longer shows it.
    await page.goto('/properties');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Historical Property')).not.toBeVisible();

    // Archived filter shows it.
    await page.getByLabel('Status').selectOption('archived');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Historical Property')).toBeVisible();

    // All filter shows it too.
    await page.getByLabel('Status').selectOption('all');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Historical Property')).toBeVisible();

    // Detail/history remains fully accessible while archived -- Units is a tab, not the default
    // Overview view, so it must be selected before its content (the "101" unit label) is checked.
    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^Units/ }).click();
    await expect(page.getByText('101')).toBeVisible();

    // Restore -- also a window.confirm(), same as archive.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Restore property' }).click();
    await expect(page.getByRole('button', { name: 'Archive property' })).toBeVisible({ timeout: 30_000 });

    await page.goto('/properties');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Historical Property')).toBeVisible();
  });
});

test.describe('F. Empty unit delete', () => {
  test('deleting an unused unit removes only that unit -- the property and sibling units remain', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'qa-empty-unit-delete');
    const propertyId = await createProperty(page.request, orgId, 'Musgrave Heights');
    const doomedUnitId = await createUnit(page.request, propertyId, '602');
    const siblingUnitId = await createUnit(page.request, propertyId, '601');

    await page.goto(`/properties/${propertyId}/units/${doomedUnitId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await page.getByLabel(/Type .* to confirm/i).fill('602');
    await page
      .locator('div', { hasText: 'This permanently deletes Unit 602' })
      .getByRole('button', { name: 'Delete permanently' })
      .click();
    await page.waitForURL(`**/properties/${propertyId}`);

    const goneCheck = await page.request.get(`/api/v1/units/${doomedUnitId}`);
    expect(goneCheck.status()).toBe(404);

    const propertyCheck = await page.request.get(`/api/v1/properties/${propertyId}`);
    expect(propertyCheck.ok()).toBe(true);
    const siblingCheck = await page.request.get(`/api/v1/units/${siblingUnitId}`);
    expect(siblingCheck.ok()).toBe(true);
  });
});

test.describe('G. Unit with active lease', () => {
  test('archiving/deleting a unit with an active lease is blocked, occupancy is untouched, and no tenancy is implicitly terminated', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'qa-unit-active-lease-block');
    const propertyId = await createProperty(page.request, orgId, 'Musgrave Heights');
    const unitId = await createUnit(page.request, propertyId, '601');
    const leaseId = await createManualLease(page.request, orgId, unitId);
    const tenantId = await createTenant(page.request, orgId, 'Unit Active Lease QA Tenant');
    await assignTenantAndActivate(page.request, leaseId, tenantId);

    await page.goto(`/properties/${propertyId}/units/${unitId}`);
    await page.waitForLoadState('networkidle');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Archive unit' }).click();
    await expect(page.getByText(/active lease/i)).toBeVisible({ timeout: 30_000 });

    expect(await getUnitStatus(page.request, unitId)).toBe('occupied');
    const leaseCheck = await page.request.get(`/api/v1/leases/${leaseId}`);
    expect((await leaseCheck.json()).lease.status).toBe('active');
  });
});

test.describe('H. Unit archive + restore', () => {
  test('archiving a unit hides it from the default selection, keeps history accessible, blocks new tenancy while archived, and restore returns it to vacant (never occupied)', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'qa-unit-archive-restore');
    const propertyId = await createProperty(page.request, orgId, 'Musgrave Heights');
    const unitId = await createUnit(page.request, propertyId, '601');

    await page.goto(`/properties/${propertyId}/units/${unitId}`);
    await page.waitForLoadState('networkidle');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Archive unit' }).click();
    await expect(page.getByRole('button', { name: 'Restore unit' })).toBeVisible({ timeout: 30_000 });
    expect(await getUnitStatus(page.request, unitId)).toBe('archived');

    // Excluded from the default (non-archived) selection on the property's Units tab.
    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^Units/ }).click();
    await expect(page.getByText('601').first()).not.toBeVisible();

    // Historical/detail page remains accessible while archived.
    await page.goto(`/properties/${propertyId}/units/${unitId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: '601' })).toBeVisible();

    // Cannot create/activate a new tenancy against the archived unit (P0 guard).
    const tenantId = await createTenant(page.request, orgId, 'Archived Unit Guard Tenant');
    const leaseId = await createManualLease(page.request, orgId, unitId);
    await page.request.post(`/api/v1/leases/${leaseId}/tenants`, {
      headers: { Origin: BASE_URL },
      data: { tenantId, isPrimary: true },
    });
    const activateResponse = await page.request.post(`/api/v1/leases/${leaseId}/activate`, {
      headers: { Origin: BASE_URL },
    });
    expect(activateResponse.ok()).toBe(false);
    const activateBody = await activateResponse.json();
    expect(activateBody.error.message).toContain('archived');
    expect(await getUnitStatus(page.request, unitId)).toBe('archived');

    const applicationResponse = await page.request.post('/api/v1/applications', {
      headers: { Origin: BASE_URL },
      data: { orgId, propertyId, unitId, applicantName: 'Archived Unit Guard Applicant' },
    });
    expect(applicationResponse.ok()).toBe(false);
    expect(applicationResponse.status()).toBe(409);

    // Restore returns the unit to vacant, never occupied.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Restore unit' }).click();
    await expect(page.getByRole('button', { name: 'Archive unit' })).toBeVisible({ timeout: 30_000 });
    expect(await getUnitStatus(page.request, unitId)).toBe('vacant');

    // The previously-blocked lease now activates normally.
    const activateAfterRestore = await page.request.post(`/api/v1/leases/${leaseId}/activate`, {
      headers: { Origin: BASE_URL },
    });
    expect(activateAfterRestore.ok()).toBe(true);
    expect(await getUnitStatus(page.request, unitId)).toBe('occupied');
  });
});

test.describe('Archived property blocks new operational records', () => {
  test('an archived property cannot receive a new unit or a new application, and restoring it lifts both blocks', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'qa-archived-property-blocks-new-records');
    const propertyId = await createProperty(page.request, orgId, 'Archived Records Property');
    // A property can be archived while a vacant unit remains (archive_property() only blocks on
    // active leases, not on unit status) -- this unit stays 'vacant' throughout, proving the
    // block is driven by the PROPERTY's own archived status, not the unit's.
    const unitId = await createUnit(page.request, propertyId, '601');

    const archiveResponse = await page.request.delete(`/api/v1/properties/${propertyId}`, {
      headers: { Origin: BASE_URL },
    });
    expect(archiveResponse.ok()).toBe(true);
    expect(await getUnitStatus(page.request, unitId)).toBe('vacant');

    const newUnitResponse = await page.request.post(`/api/v1/properties/${propertyId}/units`, {
      headers: { Origin: BASE_URL },
      data: { unitLabel: '602' },
    });
    expect(newUnitResponse.ok()).toBe(false);
    expect(newUnitResponse.status()).toBe(409);
    const newUnitBody = await newUnitResponse.json();
    expect(newUnitBody.error.code).toBe('property_archived');

    const applicationResponse = await page.request.post('/api/v1/applications', {
      headers: { Origin: BASE_URL },
      data: { orgId, propertyId, unitId, applicantName: 'Archived Property Guard Applicant' },
    });
    expect(applicationResponse.ok()).toBe(false);
    expect(applicationResponse.status()).toBe(409);
    const applicationBody = await applicationResponse.json();
    expect(applicationBody.error.code).toBe('property_archived');

    // Restoring the property lifts both blocks.
    const restoreResponse = await page.request.post(`/api/v1/properties/${propertyId}/restore`, {
      headers: { Origin: BASE_URL },
    });
    expect(restoreResponse.ok()).toBe(true);

    const newUnitAfterRestore = await page.request.post(`/api/v1/properties/${propertyId}/units`, {
      headers: { Origin: BASE_URL },
      data: { unitLabel: '602' },
    });
    expect(newUnitAfterRestore.ok()).toBe(true);

    const applicationAfterRestore = await page.request.post('/api/v1/applications', {
      headers: { Origin: BASE_URL },
      data: { orgId, propertyId, unitId, applicantName: 'Post-Restore Applicant' },
    });
    expect(applicationAfterRestore.ok()).toBe(true);
  });
});
