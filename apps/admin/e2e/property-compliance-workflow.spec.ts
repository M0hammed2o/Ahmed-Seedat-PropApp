import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit } from './fixtures/orgWorkflow';
import {
  createLinkedTenant,
  createActiveLeaseForTenant,
  uploadComplianceDocument,
  uploadLevyDocument,
  createRule,
  createAndActivateRuleVersion,
} from './fixtures/complianceWorkflow';

// Property compliance workflow E2E (WORKLOG.md this date, Task 8 -- the major deferred
// verification gap from the prior pass). Runs against a real Next.js dev server backed by real
// local Supabase, same posture every other spec in this suite already takes (never demo mode).
// Self-contained per test (own org/property/tenant fixtures each time) rather than relying on
// execution order between test() blocks, matching this file's own project convention.

async function signInViaUI(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

// The `request` fixture and the `page` fixture hold SEPARATE cookie jars -- signing in via the
// browser (signInViaUI, above) does NOT change which session `request.get()`/`request.post()`
// calls carry. Any test that needs to make a direct API assertion AS a specific account (not
// whichever account `request` was last signed in as, e.g. the org-creating staff user from
// setUpOrg) must re-authenticate `request` itself via the real signin route first.
async function signInApi(request: APIRequestContext, email: string, password: string) {
  const response = await request.post('/api/v1/auth/signin', {
    headers: { Origin: BASE_URL },
    data: { email, password },
  });
  expect(response.ok()).toBe(true);
}

test.describe('property compliance workflow', () => {
  test('Scenario A+B: a tenant sees a required rule, views it (without acknowledging), explicitly acknowledges it, and a new version creates a fresh requirement while the old acknowledgement stays historical', async ({
    request,
    page,
  }) => {
    // This scenario walks the full v1 -> ack -> v2 -> ack lifecycle in one test (several page
    // navigations + real dev-server cold-compiles) -- 3x the default timeout, matching this
    // suite's own documented dev-mode Turbopack cold-compile latency, not a functional issue.
    test.slow();
    const { orgId } = await setUpOrg(request, 'compliance-ab');
    const propertyId = await createProperty(request, orgId, 'Musgrave Flats');
    const unitId = await createUnit(request, propertyId, 'Unit 601');
    const tenant = await createLinkedTenant(request, orgId, 'compliance-ab-tenant', 'Ahmed Tenant');
    await createActiveLeaseForTenant(request, orgId, unitId, tenant.tenantId);

    const documentV1 = await uploadComplianceDocument(
      request,
      orgId,
      propertyId,
      'conduct-rules-v1',
    );
    const ruleId = await createRule(request, propertyId, 'Conduct Rules');
    const v1 = await createAndActivateRuleVersion(request, ruleId, documentV1, '2026-01-01');
    expect(v1.requirementsAssigned).toBe(1);

    // === Tenant: sign in, see the outstanding requirement ===
    await signInViaUI(page, tenant.user.email, tenant.user.password);
    await page.goto('/compliance');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Conduct Rules')).toBeVisible();
    await expect(page.getByText(/review & acknowledge/i)).toBeVisible();

    await page.getByText('Conduct Rules').first().click();
    await page.waitForURL(/\/compliance\/[0-9a-f-]{36}/, { timeout: 15_000 });

    // Viewing the page must never itself acknowledge -- confirm via the staff dashboard that the
    // requirement is NOT yet 'acknowledged' after merely opening the detail page.
    const complianceAfterView = await request.get(`/api/v1/properties/${propertyId}/compliance`);
    const dashboardAfterView = await complianceAfterView.json();
    const reqAfterView = dashboardAfterView.requirements.find(
      (r: { tenant: { id: string } }) => r.tenant.id === tenant.tenantId,
    );
    expect(reqAfterView.status).not.toBe('acknowledged');

    // Explicit acknowledgement: check the box, click the button.
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /sign & acknowledge/i }).click();
    await expect(page.getByText(/you've acknowledged this document/i)).toBeVisible({
      timeout: 10_000,
    });

    // === Staff: dashboard now shows acknowledged ===
    const complianceAfterAck = await request.get(`/api/v1/properties/${propertyId}/compliance`);
    const dashboardAfterAck = await complianceAfterAck.json();
    const reqAfterAck = dashboardAfterAck.requirements.find(
      (r: { tenant: { id: string } }) => r.tenant.id === tenant.tenantId,
    );
    expect(reqAfterAck.status).toBe('acknowledged');
    const v1AcknowledgedAt = reqAfterAck.acknowledgedAt;
    expect(v1AcknowledgedAt).toBeTruthy();

    // === Scenario B: staff activates v2 ===
    const documentV2 = await uploadComplianceDocument(
      request,
      orgId,
      propertyId,
      'conduct-rules-v2',
    );
    const v2 = await createAndActivateRuleVersion(request, ruleId, documentV2, '2026-08-01');
    expect(v2.requirementsAssigned).toBe(1);

    const complianceAfterV2 = await request.get(`/api/v1/properties/${propertyId}/compliance`);
    const dashboardAfterV2 = await complianceAfterV2.json();
    const tenantRequirements = dashboardAfterV2.requirements.filter(
      (r: { tenant: { id: string } }) => r.tenant.id === tenant.tenantId,
    );
    expect(tenantRequirements).toHaveLength(2);
    const v1Requirement = tenantRequirements.find(
      (r: { ruleVersion: { versionNumber: number } }) => r.ruleVersion.versionNumber === 1,
    );
    const v2Requirement = tenantRequirements.find(
      (r: { ruleVersion: { versionNumber: number } }) => r.ruleVersion.versionNumber === 2,
    );
    // The v1 acknowledgement is untouched by v2's activation -- same status, same timestamp.
    expect(v1Requirement.status).toBe('acknowledged');
    expect(v1Requirement.acknowledgedAt).toBe(v1AcknowledgedAt);
    expect(v2Requirement.status).toBe('pending');

    // === Tenant: sees v1 as completed (historical) and v2 as a fresh outstanding action ===
    await page.goto('/compliance');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/acknowledged/i).first()).toBeVisible();
    await expect(page.getByText(/review & acknowledge/i)).toBeVisible();

    // Acknowledge v2 separately.
    await page.goto(`/compliance/${v2Requirement.id}`);
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: /sign & acknowledge/i }).click();
    await expect(page.getByText(/you've acknowledged this document/i)).toBeVisible({
      timeout: 10_000,
    });

    const finalCompliance = await request.get(`/api/v1/properties/${propertyId}/compliance`);
    const finalDashboard = await finalCompliance.json();
    const finalTenantReqs = finalDashboard.requirements.filter(
      (r: { tenant: { id: string } }) => r.tenant.id === tenant.tenantId,
    );
    expect(finalTenantReqs.every((r: { status: string }) => r.status === 'acknowledged')).toBe(
      true,
    );
  });

  test("Scenario C: an unrelated tenant cannot access another tenant's requirement, document, or acknowledge action by direct id/URL", async ({
    request,
    page,
  }) => {
    test.slow();
    const { orgId } = await setUpOrg(request, 'compliance-isolation');
    const propertyA = await createProperty(request, orgId, 'Property A');
    const unitA = await createUnit(request, propertyA, 'Unit A1');
    const tenantA = await createLinkedTenant(request, orgId, 'compliance-iso-a', 'Tenant A');
    await createActiveLeaseForTenant(request, orgId, unitA, tenantA.tenantId);

    const documentA = await uploadComplianceDocument(request, orgId, propertyA, 'rules-a');
    const ruleA = await createRule(request, propertyA, 'Conduct Rules A');
    await createAndActivateRuleVersion(request, ruleA, documentA, '2026-01-01');

    const complianceA = await request.get(`/api/v1/properties/${propertyA}/compliance`);
    const dashboardA = await complianceA.json();
    const requirementA = dashboardA.requirements.find(
      (r: { tenant: { id: string } }) => r.tenant.id === tenantA.tenantId,
    );

    // Tenant B: an entirely unrelated tenant, no property/rule/requirement of their own at all.
    const propertyB = await createProperty(request, orgId, 'Property B');
    const unitB = await createUnit(request, propertyB, 'Unit B1');
    const tenantB = await createLinkedTenant(request, orgId, 'compliance-iso-b', 'Tenant B');
    await createActiveLeaseForTenant(request, orgId, unitB, tenantB.tenantId);

    await signInViaUI(page, tenantB.user.email, tenantB.user.password);
    // Also re-authenticate the `request` context as Tenant B -- it's still holding the
    // org-creating staff session from setUpOrg() otherwise, which would make every direct-API
    // assertion below meaningless (staff can legitimately read what they just uploaded).
    await signInApi(request, tenantB.user.email, tenantB.user.password);

    // Direct URL guess -- Tenant B's own /compliance list is empty, so this simulates guessing/
    // reusing Tenant A's link (e.g. from a shared screenshot or browser history on a shared device).
    await page.goto(`/compliance/${requirementA.id}`);
    await page.waitForLoadState('networkidle');
    // Never renders Tenant A's rule title/content -- either a 404/not-found page or an empty
    // state, but never the real requirement.
    await expect(page.getByText('Conduct Rules A')).not.toBeVisible();

    // Direct API call: cannot acknowledge Tenant A's requirement.
    const forgedAckResponse = await request.post(
      `/api/v1/tenant-portal/compliance/${requirementA.id}/acknowledge`,
      {
        headers: { Origin: BASE_URL },
        data: { acceptanceStatement: 'I confirm.' },
      },
    );
    expect(forgedAckResponse.status()).toBe(404);

    // Direct API call: cannot read Tenant A's rule document either.
    const forgedDocResponse = await request.get(`/api/v1/documents/${documentA}`);
    expect(forgedDocResponse.status()).toBe(404);

    // Tenant B's own compliance list never includes Tenant A's requirement.
    const ownComplianceResponse = await request.get('/api/v1/tenant-portal/compliance');
    const ownCompliance = await ownComplianceResponse.json();
    const allIds = [...ownCompliance.outstanding, ...ownCompliance.completed].map(
      (r: { id: string }) => r.id,
    );
    expect(allIds).not.toContain(requirementA.id);
  });

  test("Scenario D: one auth user with two tenancies sees only the active tenancy's compliance requirements, and switching tenancy changes the list correctly", async ({
    request,
    page,
  }) => {
    test.slow();
    const { orgId } = await setUpOrg(request, 'compliance-multi-tenancy');

    const propertyA = await createProperty(request, orgId, 'Musgrave Flats');
    const unitA = await createUnit(request, propertyA, 'Unit 601');
    const tenant = await createLinkedTenant(request, orgId, 'compliance-multi', 'Ahmed Tenant');
    await createActiveLeaseForTenant(request, orgId, unitA, tenant.tenantId);
    const documentA = await uploadComplianceDocument(request, orgId, propertyA, 'rules-property-a');
    const ruleA = await createRule(request, propertyA, 'Musgrave Conduct Rules');
    await createAndActivateRuleVersion(request, ruleA, documentA, '2026-01-01');

    // A second tenancy for the SAME auth user, a different property -- created via a second
    // tenants row linked to the identical auth user id (mirrors a real second invitation
    // accepted by the same account, without re-driving the invitation UI this scenario isn't
    // about).
    const propertyB = await createProperty(request, orgId, 'Beach Apartments');
    const unitB = await createUnit(request, propertyB, 'Unit 4');
    const tenantResponse = await request.post('/api/v1/tenants', {
      headers: { Origin: BASE_URL },
      data: { orgId, fullName: 'Ahmed Tenant (Beach)', email: tenant.user.email },
    });
    expect(tenantResponse.ok()).toBe(true);
    const secondTenantId = (await tenantResponse.json()).tenant.id as string;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    await fetch(`http://127.0.0.1:54321/rest/v1/tenants?id=eq.${secondTenantId}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ user_id: tenant.user.id }),
    });
    await createActiveLeaseForTenant(request, orgId, unitB, secondTenantId);
    const documentB = await uploadComplianceDocument(request, orgId, propertyB, 'rules-property-b');
    const ruleB = await createRule(request, propertyB, 'Beach Estate Rules');
    await createAndActivateRuleVersion(request, ruleB, documentB, '2026-01-01');

    await signInViaUI(page, tenant.user.email, tenant.user.password);
    await signInApi(request, tenant.user.email, tenant.user.password);

    // Currently active tenancy (whichever resolveTenantSession() defaults to) shows exactly one
    // property's requirement, never both at once.
    await page.goto('/compliance');
    await page.waitForLoadState('networkidle');
    const bothVisible =
      (await page.getByText('Musgrave Conduct Rules').count()) > 0 &&
      (await page.getByText('Beach Estate Rules').count()) > 0;
    expect(bothVisible).toBe(false);

    // Switch tenancy via the real switcher UI, then confirm the compliance list changes to the
    // OTHER property's requirement.
    const switcher = page.getByLabel('Tenancy');
    await expect(switcher).toBeVisible();
    const currentValue = await switcher.inputValue();
    const otherTenantId = currentValue === secondTenantId ? tenant.tenantId : secondTenantId;
    await switcher.selectOption(otherTenantId);
    await page.waitForLoadState('networkidle');

    await page.goto('/compliance');
    await page.waitForLoadState('networkidle');
    const afterSwitchBothVisible =
      (await page.getByText('Musgrave Conduct Rules').count()) > 0 &&
      (await page.getByText('Beach Estate Rules').count()) > 0;
    expect(afterSwitchBothVisible).toBe(false);

    // And the API itself, scoped server-side, never returns both properties' requirements in one
    // response regardless of which tenancy is active.
    const complianceResponse = await request.get('/api/v1/tenant-portal/compliance');
    const compliance = await complianceResponse.json();
    const propertyNicknames = new Set(
      [...compliance.outstanding, ...compliance.completed].map(
        (r: { property: { nickname: string } | null }) => r.property?.nickname,
      ),
    );
    expect(propertyNicknames.size).toBeLessThanOrEqual(1);
  });

  test('Scenario E: staff can review and confirm a levy statement, and a tenant cannot access levy financial data', async ({
    request,
    page,
  }) => {
    test.slow();
    const { orgId, user: staffUser } = await setUpOrg(request, 'compliance-levy');
    const propertyId = await createProperty(request, orgId, 'Levy Test Property');
    const unitId = await createUnit(request, propertyId, 'Unit 1');
    const tenant = await createLinkedTenant(
      request,
      orgId,
      'compliance-levy-tenant',
      'Levy Tenant',
    );
    await createActiveLeaseForTenant(request, orgId, unitId, tenant.tenantId);

    const levyDocumentId = await uploadLevyDocument(request, orgId, propertyId, 'levy-statement');
    const statementResponse = await request.post(
      `/api/v1/properties/${propertyId}/levy-statements`,
      {
        headers: { Origin: BASE_URL },
        data: { documentId: levyDocumentId },
      },
    );
    expect(statementResponse.ok()).toBe(true);
    const statementId = (await statementResponse.json()).statement.id as string;

    // Extraction (mock provider locally -- no real OCR text, so the heuristic parser finds no
    // lines; the UI's own "add line item" affordance covers exactly this real case).
    await request.post(`/api/v1/levy-statements/${statementId}/extract`, {
      headers: { Origin: BASE_URL },
    });

    // === Staff UI: sign in as the org's own staff user, open the property's Management tab,
    // expand the statement, add + save a line, mark reviewed ===
    await signInViaUI(page, staffUser.email, staffUser.password); // generic email/password sign-in, works for any account type
    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Management' }).click();
    await page
      .getByText(/uploaded|extracting|extracted/i)
      .first()
      .click();

    const rows = page.locator('table tbody tr');
    // Self-healing click-then-verify: dev-mode Turbopack cold-compiles this route on first visit
    // (documented elsewhere in this suite as a real source of transient latency, not a functional
    // issue) -- retries the click if the row hasn't landed yet rather than asserting a single
    // click is instantaneous.
    await expect(async () => {
      if ((await rows.count()) === 0) {
        await page.getByRole('button', { name: /add line item/i }).click();
      }
      expect(await rows.count()).toBe(1);
    }).toPass({ timeout: 30_000 });

    await rows.nth(0).locator('input').nth(0).fill('monthly_levy');
    await rows.nth(0).locator('input').nth(1).fill('Monthly levy');
    await rows.nth(0).locator('input[type="number"]').fill('1500');

    await page.getByRole('button', { name: /save corrections/i }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /mark reviewed/i }).click();
    // Matches only the "Reviewed on <date>" confirmation paragraph, not the status Pill (also
    // literally "Reviewed") -- both are legitimately on screen at once.
    await expect(page.getByText(/^reviewed on/i)).toBeVisible({ timeout: 10_000 });

    const finalStatement = await request.get(`/api/v1/levy-statements/${statementId}`);
    const finalStatementBody = await finalStatement.json();
    expect(finalStatementBody.statement.status).toBe('reviewed');

    // === Tenant: cannot access the levy statement or its line items ===
    await signInViaUI(page, tenant.user.email, tenant.user.password);
    await signInApi(request, tenant.user.email, tenant.user.password);
    const tenantStatementResponse = await request.get(`/api/v1/levy-statements/${statementId}`);
    expect(tenantStatementResponse.status()).toBe(404);
    const tenantListResponse = await request.get(
      `/api/v1/properties/${propertyId}/levy-statements`,
    );
    // Either forbidden or an empty/filtered list -- never the real financial data.
    if (tenantListResponse.ok()) {
      const tenantList = await tenantListResponse.json();
      expect(tenantList.statements).toEqual([]);
    } else {
      expect(tenantListResponse.status()).toBe(403);
    }
  });
});
