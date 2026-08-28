import { test, expect, type Page } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit, getUnitStatus } from './fixtures/orgWorkflow';
import { createConfirmedPlatformAdmin } from './fixtures/platformAdmin';
import { generateTotpCode } from './fixtures/totp';

// FINAL PRE-DEPLOYMENT CLOSEOUT (WORKLOG.md this date), Section 3: real browser-level
// verification of the remaining four launch flows (D/E/F/G). Same setup conventions as
// v1-closeout-tenancy-flows.spec.ts -- page.request for API scaffolding (shares cookies with
// page.goto), real UI interactions for every step the closeout brief names explicitly.

/** Dismisses the first-run guided-tour overlay if it's showing. KNOWN RESIDUAL RISK (disclosed in
 * the closeout report, not fixed further this pass): WalkthroughOverlay.tsx is a deliberately
 * lightweight `fixed bottom-5 right-5` card (its own comment: "not a full DOM-spotlight engine",
 * a documented prior scope decision) rather than one anchored to the element it describes -- V1
 * closeout browser-quality testing already found and fixed one real instance of it blocking a
 * click (a body-text row swallowing a click meant for a page underneath, WORKLOG.md this date);
 * this run additionally found its still-necessarily-solid button row can overlap a short page's
 * own bottom-positioned primary action (reproduced: /accounting/expenses/new's "Record expense"
 * button). Redesigning the tour into a spotlight-anchored one is out of this closeout's "do not
 * redesign" scope -- dismissing it first, exactly like a careful real user would, is what lets
 * the rest of this flow's real assertions run.  */
async function dismissWalkthroughIfPresent(page: Page): Promise<void> {
  const skipButton = page.getByRole('button', { name: 'Skip tour', exact: true });
  if (await skipButton.isVisible().catch(() => false)) {
    await skipButton.click();
    await expect(skipButton).not.toBeVisible({ timeout: 5_000 });
  }
}

/** Reads a KPI tile's rendered value: both the property-accounting tab and the portfolio
 * dashboard render `<p>{label}</p><p>{value}</p>` as adjacent siblings inside a Panel/card --
 * this matches either page identically, which is exactly what Flow F needs to compare them. An
 * exact (anchored) match on the label is required, not a substring one -- the property page's
 * always-visible hero band separately renders an "Expenses YTD" tile using this same markup
 * pattern, which a plain substring match against "Expenses" would collide with. */
async function tileValue(page: Page, label: string): Promise<string> {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = await page
    .locator('p')
    .filter({ hasText: new RegExp(`^${escaped}$`) })
    .first()
    .locator('xpath=following-sibling::p[1]')
    .innerText();
  return value.trim();
}

test.describe('Flow D: ownership', () => {
  test('self-owner, edit percentage, a second external owner, then removing them leaves the owner identity intact', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'closeout-ownership');
    const propertyId = await createProperty(page.request, orgId, 'Closeout Ownership Property');

    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Ownership' }).click();

    await expect(
      page.getByText('No owner recorded for this property yet.', { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    // === Principal owns property: self-owner path ===
    await page.getByRole('button', { name: 'Yes, I own this property' }).click();
    await expect(page.getByRole('button', { name: 'Add owner' })).toBeVisible();
    await page.getByRole('button', { name: 'Add owner' }).click();
    await expect(page.getByText('100%', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Total: 100%')).toBeVisible();

    // === Edit percentage ===
    // The "Current ownership" panel (containing the row-level edit input) renders before the
    // "Add an owner" panel (which always has its own, separate percentage input) -- .first()
    // targets the row's edit input, not the add-owner form's.
    await page.getByRole('button', { name: 'Edit %' }).click();
    const editingRow = page.locator('li').filter({ has: page.locator('input[type="number"]') });
    await editingRow.locator('input[type="number"]').fill('60');
    await editingRow.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('60%', { exact: true })).toBeVisible({ timeout: 15_000 });

    // === Multi-owner: a second, external (non-linked) owner ===
    await page.getByRole('button', { name: 'Create new owner' }).click();
    await page.getByLabel('Name').fill('External Co-Owner');
    await page.getByLabel('Email (optional)').fill('external-co-owner@example.com');
    await page.getByLabel('Ownership percentage').fill('40');
    await page.getByRole('button', { name: 'Add owner' }).click();
    await expect(page.getByText('External Co-Owner')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Total: 100%')).toBeVisible();

    const ownersCheck = await (
      await page.request.get(`/api/v1/properties/${propertyId}/owners`)
    ).json();
    expect(ownersCheck.propertyOwners).toHaveLength(2);

    // === Remove the external co-owner's relationship, keep their identity ===
    page.once('dialog', (dialog) => dialog.accept());
    const externalOwnerRow = page.locator('li', { hasText: 'External Co-Owner' });
    await externalOwnerRow.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('External Co-Owner')).not.toBeVisible({ timeout: 15_000 });

    const ownersAfterRemove = await (
      await page.request.get(`/api/v1/properties/${propertyId}/owners`)
    ).json();
    expect(ownersAfterRemove.propertyOwners).toHaveLength(1);

    // The owner IDENTITY record itself was never deleted -- only the property relationship.
    const allOwners = await (await page.request.get(`/api/v1/owners?filter[org_id]=${orgId}`)).json();
    expect(
      (allOwners.owners as { name: string }[]).some((o) => o.name === 'External Co-Owner'),
    ).toBe(true);
  });
});

test.describe('Flow D: ownership (managing agent)', () => {
  test('a property has no owner until one is explicitly added -- the staff principal is never assumed to be the owner', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'closeout-ownership-agency');
    const propertyId = await createProperty(page.request, orgId, 'Closeout Agency Property');

    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Ownership' }).click();
    await expect(
      page.getByText('No owner recorded for this property yet.', { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Create new owner' }).click();
    await page.getByLabel('Name').fill('Property Owner Pty Ltd');
    await page.getByLabel('Ownership percentage').fill('100');
    await page.getByRole('button', { name: 'Add owner' }).click();
    await expect(page.getByText('Property Owner Pty Ltd')).toBeVisible({ timeout: 15_000 });

    // The external owner has no user_id -- never silently linked to the staff principal's own
    // account.
    const ownersCheck = await (
      await page.request.get(`/api/v1/properties/${propertyId}/owners`)
    ).json();
    expect(ownersCheck.propertyOwners).toHaveLength(1);
    expect(ownersCheck.propertyOwners[0].owner.user_id).toBeNull();
    void orgId;
  });
});

test.describe('Flow E: expense with evidence, posted to the ledger, visible in both accounting views', () => {
  test('creating and recording an expense with evidence updates property and portfolio accounting', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'closeout-expense');
    const propertyId = await createProperty(page.request, orgId, 'Closeout Expense Property');

    await page.goto('/accounting/expenses/new');
    await page.waitForLoadState('networkidle');
    await dismissWalkthroughIfPresent(page);

    await page.getByLabel('Category').fill('Plumbing repair');
    await page.getByLabel('Amount (ZAR)').fill('1850');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'receipt.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%synthetic receipt\n%%EOF'),
    });

    await page.getByRole('button', { name: 'Add expense' }).click();
    await page.waitForURL(/\/accounting\/expenses\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const expenseId = page.url().split('/expenses/')[1];

    await expect(page.getByText('View attached evidence →')).toBeVisible({ timeout: 15_000 });

    // === Post it to the ledger (evidence already attached -- no exception-reason box) ===
    await expect(
      page.getByText('No evidence is attached', { exact: false }),
    ).not.toBeVisible();
    await page.getByRole('button', { name: 'Record expense' }).click();
    await expect(page.getByText(/Posted to the ledger/)).toBeVisible({ timeout: 15_000 });

    // No GET /api/v1/expenses/:id exists -- the list endpoint (with the same org filter the
    // expenses index page itself uses) is the only read route available.
    const expensesList = await (
      await page.request.get(`/api/v1/expenses?filter[org_id]=${orgId}`)
    ).json();
    const recordedExpense = (expensesList.expenses as { id: string; status: string; journalEntryId: string | null }[]).find(
      (e) => e.id === expenseId,
    );
    expect(recordedExpense?.status).toBe('recorded');
    expect(recordedExpense?.journalEntryId).toBeTruthy();

    // === Property accounting reflects it ===
    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Accounting' }).click();
    await expect(page.getByText('Recent relevant transactions')).toBeVisible({ timeout: 15_000 });
    const propertyExpensesTile = await tileValue(page, 'Expenses');
    expect(propertyExpensesTile).not.toBe('R0');

    // === Portfolio accounting also reflects it (same authoritative source, same period) ===
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const portfolioExpensesTile = await tileValue(page, 'Expenses');
    expect(portfolioExpensesTile).toBe(propertyExpensesTile);
  });
});

test.describe('Flow F: property accounting reconciles with portfolio accounting', () => {
  test('for a single-property org, every property KPI equals the corresponding portfolio KPI', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'closeout-reconciliation');
    const propertyId = await createProperty(page.request, orgId, 'Closeout Reconciliation Property');
    const unitId = await createUnit(page.request, propertyId, 'Unit R1');

    const tenantResponse = await page.request.post('/api/v1/tenants', {
      headers: { Origin: BASE_URL },
      data: { orgId, fullName: 'Reconciliation Tenant' },
    });
    const tenant = await tenantResponse.json();

    // An active lease so rent-schedule KPIs (Expected/Collected/Outstanding) are non-trivial.
    const leaseResponse = await page.request.post('/api/v1/leases', {
      headers: { Origin: BASE_URL },
      data: {
        orgId,
        unitId,
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        rentAmount: 10000,
        depositAmount: 0,
      },
    });
    const lease = await leaseResponse.json();
    await page.request.post(`/api/v1/leases/${lease.lease.id}/tenants`, {
      headers: { Origin: BASE_URL },
      data: { tenantId: tenant.tenant.id, isPrimary: true },
    });
    await page.request.post(`/api/v1/leases/${lease.lease.id}/activate`, {
      headers: { Origin: BASE_URL },
    });
    expect(await getUnitStatus(page.request, unitId)).toBe('occupied');

    // Plus an expense, so Expenses/Net income are non-trivial too.
    const expenseResponse = await page.request.post('/api/v1/expenses', {
      headers: { Origin: BASE_URL },
      data: { orgId, propertyId, category: 'Reconciliation test expense', amount: 500 },
    });
    const expense = await expenseResponse.json();
    await page.request.post(`/api/v1/expenses/${expense.expense.id}/record`, {
      headers: { Origin: BASE_URL },
      data: { paidImmediately: true, exceptionReason: 'E2E reconciliation fixture, no evidence needed' },
    });

    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await dismissWalkthroughIfPresent(page);
    await page.getByRole('button', { name: 'Accounting' }).click();
    await expect(page.getByText('Recent relevant transactions')).toBeVisible({ timeout: 15_000 });

    const propertyTiles = {
      expectedRent: await tileValue(page, 'Expected rent'),
      rentCollected: await tileValue(page, 'Rent collected'),
      outstandingRent: await tileValue(page, 'Outstanding rent'),
      expenses: await tileValue(page, 'Expenses'),
    };

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    expect(await tileValue(page, 'Expected rent')).toBe(propertyTiles.expectedRent);
    expect(await tileValue(page, 'Rent collected')).toBe(propertyTiles.rentCollected);
    expect(await tileValue(page, 'Outstanding rent')).toBe(propertyTiles.outstandingRent);
    expect(await tileValue(page, 'Expenses')).toBe(propertyTiles.expenses);
  });
});

test.describe('Flow G: referral attribution', () => {
  test('a valid referral code is attributed and visible to Platform Admin; no code and an invalid code both still work', async ({
    page,
    browser,
  }) => {
    // Genuinely a lot of sequential real round trips: platform-admin MFA enrollment, a referral
    // partner, three full real-browser signup+create-organization passes, and two admin-view
    // navigations -- observed live to occasionally exceed 120s on this shared local dev
    // environment after a long test session's accumulated load, not a sign of anything hanging.
    test.setTimeout(300_000);

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const admin = await createConfirmedPlatformAdmin('closeout-referral-admin');

    // getAdminSession() (lib/auth.ts) requires AAL2 -- a real TOTP enrollment round trip, not just
    // signing in, exactly like super-admin-separation.spec.ts's own "with MFA enrolled" test.
    // Without this, every /api/v1/admin/** call below would 403 regardless of the seeded
    // super_admin role.
    await adminPage.goto('/login');
    await adminPage.waitForLoadState('networkidle');
    await adminPage.locator('input[type="email"]').fill(admin.email);
    await adminPage.locator('input[type="password"]').fill(admin.password);
    await adminPage.getByRole('button', { name: /sign in/i }).click();
    await adminPage.waitForURL(/\/platform-admin\/mfa-setup/, { timeout: 15_000 });
    await adminPage
      .getByRole('button', { name: /add authenticator app/i })
      .click({ timeout: 30_000 });
    const secretLocator = adminPage.locator('code');
    await expect(secretLocator).toBeVisible({ timeout: 10_000 });
    const secret = (await secretLocator.textContent())?.trim();
    expect(secret).toBeTruthy();
    await adminPage.locator('input[inputmode="numeric"]').fill(generateTotpCode(secret!));
    await adminPage.getByRole('button', { name: /^confirm$/i }).click();
    await adminPage.waitForURL(/\/platform-admin\/overview/, { timeout: 15_000 });

    // A real referral partner + code the "valid code" case will actually match.
    const partnerResponse = await adminPage.request.post('/api/v1/admin/referral-partners', {
      headers: { Origin: BASE_URL },
      data: { name: 'Closeout Referral Partner', referralCode: `CLOSEOUT${Date.now()}` },
    });
    expect(partnerResponse.ok()).toBe(true);
    const partner = await partnerResponse.json();

    // === Valid code: real browser signup -> create-organization with the referral code field ===
    const validOrg = await createOrgWithReferralCode(page, partner.referralPartner.referralCode);

    await adminPage.goto('/platform-admin/referrals');
    await adminPage.waitForLoadState('networkidle');
    await expect(adminPage.getByText(validOrg.orgName)).toBeVisible({ timeout: 15_000 });
    const attributedRow = adminPage.locator('tr', { hasText: validOrg.orgName });
    await expect(attributedRow.getByText('Closeout Referral Partner')).toBeVisible();

    // === No referral code at all: org creation still works normally ===
    const noCodeOrg = await createOrgWithReferralCode(page, '');
    expect(noCodeOrg.orgName).toBeTruthy();

    // === Invalid/unknown code: never blocks signup ===
    const invalidCodeOrg = await createOrgWithReferralCode(page, 'DOES-NOT-EXIST-CODE');
    expect(invalidCodeOrg.orgName).toBeTruthy();

    await adminPage.goto('/platform-admin/referrals');
    await adminPage.waitForLoadState('networkidle');
    await expect(adminPage.getByText(invalidCodeOrg.orgName)).toBeVisible({ timeout: 15_000 });
    const invalidRow = adminPage.locator('tr', { hasText: invalidCodeOrg.orgName });
    // Still attributed as a fallback/no-match row, never a partner name (no match for a bogus code).
    await expect(invalidRow.getByText('Closeout Referral Partner')).not.toBeVisible();

    await adminContext.close();
  });
});

/** Real browser: signup (bypassed to a pre-confirmed account, same posture as every other spec in
 * this suite -- see fixtures/testUser.ts's own comment) -> the actual create-organization UI,
 * where referral attribution is genuinely captured in this product (confirmed by reading
 * CreateOrganizationForm.tsx and app/api/v1/organizations/route.ts before writing this test --
 * there is no referral field on the register screen itself). */
async function createOrgWithReferralCode(
  page: Page,
  referralCode: string,
): Promise<{ orgId: string; orgName: string }> {
  const { createConfirmedTestUser } = await import('./fixtures/testUser');
  const { completeLegalConsentAndProfile } = await import('./fixtures/onboarding');

  const user = await createConfirmedTestUser(`closeout-referral-${referralCode || 'none'}`);
  await page.request.post('/api/v1/auth/signin', {
    headers: { Origin: BASE_URL },
    data: { email: user.email, password: user.password },
  });
  await completeLegalConsentAndProfile(page.request);

  await page.goto('/onboarding/create-organization');
  await page.waitForLoadState('networkidle');

  const orgName = `Closeout Referral Org ${Date.now()}`;
  await page.locator('input[autocomplete="organization"]').fill(orgName);
  if (referralCode) {
    // Not getByLabel: CreateOrganizationForm.tsx's <label> for this field is a plain sibling of
    // the <input>, with no htmlFor/id association -- a real (minor, non-launch-blocking)
    // accessibility gap noted in the closeout report, not fixed this pass.
    await page.getByPlaceholder('e.g. JANE2024').fill(referralCode);
  }

  // GET /api/v1/organizations only returns bare membership rows (orgId/role/status), no legal
  // name -- capturing the real POST /api/v1/organizations response (which does carry
  // { id, legalName }) is the only way to recover the id this org was actually created with.
  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/organizations') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Create organization' }).click(),
  ]);
  expect(createResponse.ok()).toBe(true);
  const created = await createResponse.json();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

  return { orgId: created.id as string, orgName };
}
