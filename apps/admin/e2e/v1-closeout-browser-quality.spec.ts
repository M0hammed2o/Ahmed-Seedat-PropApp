import { test, expect } from '@playwright/test';
import { setUpOrg, createProperty, createUnit } from './fixtures/orgWorkflow';

// FINAL PRE-DEPLOYMENT CLOSEOUT (WORKLOG.md this date), Section 4: browser quality check across
// the critical forms touched by the 7 launch flows -- console errors (desktop) and responsive
// rendering (mobile width) for the forms the closeout brief names as "critical forms". Not a
// second copy of the flow logic itself (already proven in v1-closeout-tenancy-flows.spec.ts /
// v1-closeout-ownership-accounting-referral.spec.ts) -- this only adds the quality lens those
// functional tests don't check: no browser console errors, no broken layout at mobile width.

const CRITICAL_FORM_PATHS = (propertyId: string, unitId: string) => [
  { name: 'New application', path: `/properties/${propertyId}/units/${unitId}/applications/new` },
  { name: 'Record existing lease', path: `/properties/${propertyId}/units/${unitId}/leases/new/existing` },
  { name: 'Add expense', path: '/accounting/expenses/new' },
  { name: 'Property detail', path: `/properties/${propertyId}` },
  { name: 'Dashboard', path: '/dashboard' },
];

test.describe('Browser quality: console errors on critical forms (desktop)', () => {
  test('no console errors while visiting every critical-form page', async ({ page }) => {
    test.setTimeout(120_000);

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[${msg.location().url}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const { orgId } = await setUpOrg(page.request, 'closeout-quality-desktop');
    const propertyId = await createProperty(page.request, orgId, 'Closeout Quality Property');
    const unitId = await createUnit(page.request, propertyId, 'Unit Q1');

    for (const { path } of CRITICAL_FORM_PATHS(propertyId, unitId)) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }

    // A hydration mismatch always surfaces as a real React console.error -- explicitly named in
    // the closeout brief's quality checklist alongside plain console errors.
    const hydrationErrors = consoleErrors.filter((e) => /hydration/i.test(e));
    expect(hydrationErrors, `Hydration errors found:\n${hydrationErrors.join('\n')}`).toHaveLength(0);
    expect(pageErrors, `Uncaught page errors found:\n${pageErrors.join('\n')}`).toHaveLength(0);
    expect(consoleErrors, `Console errors found:\n${consoleErrors.join('\n')}`).toHaveLength(0);
  });
});

test.describe('Browser quality: responsive layout at mobile width', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('critical forms render usably and submit correctly at mobile width', async ({ page }) => {
    test.setTimeout(120_000);

    const { orgId } = await setUpOrg(page.request, 'closeout-quality-mobile');
    const propertyId = await createProperty(page.request, orgId, 'Closeout Mobile Property');
    const unitId = await createUnit(page.request, propertyId, 'Unit Q2');

    // === New application form: every field reachable and fillable at mobile width ===
    await page.goto(`/properties/${propertyId}/units/${unitId}/applications/new`);
    await page.waitForLoadState('networkidle');
    const nameField = page.getByLabel('Applicant name');
    await expect(nameField).toBeVisible();
    await nameField.fill('Mobile Applicant');
    await page.getByLabel('Applicant email').fill('mobile-applicant@example.com');
    // The page body itself must not need horizontal scrolling at this width (a wide-content
    // container should scroll internally instead, never the page).
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(390);
    await page.getByRole('button', { name: 'Create application' }).click();
    await page.waitForURL(/\/applications\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByText('Mobile Applicant')).toBeVisible({ timeout: 15_000 });

    // === Add expense form: same check, and a real successful submission at this width ===
    await page.goto('/accounting/expenses/new');
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel('Category')).toBeVisible();
    await page.getByLabel('Category').fill('Mobile-width expense');
    await page.getByLabel('Amount (ZAR)').fill('250');
    const expenseBodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(expenseBodyWidth).toBeLessThanOrEqual(390);
    await page.getByRole('button', { name: 'Add expense' }).click();
    await page.waitForURL(/\/accounting\/expenses\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByText('Mobile-width expense')).toBeVisible({ timeout: 15_000 });

    void orgId;
  });
});
