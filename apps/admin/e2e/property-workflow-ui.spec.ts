import { test, expect } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit } from './fixtures/orgWorkflow';

// Workflow-integration pass (WORKLOG.md this date). Browser-level coverage for the pieces of this
// task that are genuinely UI behaviour, not just API contract -- the dashboard empty state, the
// property setup-guidance checklist, the photo upload panel, and the address-autocomplete/manual
// fallback on the Add Property form. Setup uses page.request (shares cookies with page.goto,
// unlike the standalone `request` fixture) so a single signed-in session drives both the API setup
// calls and the real page navigations.

test.describe('dashboard zero-properties onboarding', () => {
  test('shows the welcome/CTA panel for a brand-new org, and the normal dashboard once a property exists', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'ui-dashboard');

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Welcome to Proplyst')).toBeVisible();
    await expect(
      page.getByText('Add your first property to start tracking your portfolio.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /add your first property/i })).toBeVisible();

    await createProperty(page.request, orgId, 'First Property');

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Welcome to Proplyst')).not.toBeVisible();
    await expect(page.getByText('Portfolio value')).toBeVisible();
  });
});

test.describe('property setup guidance', () => {
  test('shows the setup checklist for an incomplete property and hides it once core steps are done', async ({
    page,
  }) => {
    const { orgId } = await setUpOrg(page.request, 'ui-setup-guidance');
    const propertyId = await createProperty(page.request, orgId, 'Guidance Property');

    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    const setupPanel = page
      .locator('section')
      .filter({ hasText: 'Finish setting up this property' });
    await expect(setupPanel).toBeVisible();
    // "Ownership" also matches the tab button of the same name -- scope to the checklist panel
    // itself to disambiguate.
    await expect(setupPanel.getByText('Ownership')).toBeVisible();
    await expect(setupPanel.getByText('Tenant or application')).toBeVisible();

    // Close every core step: ownership, a unit, an application, and a lease.
    const ownerResponse = await page.request.post('/api/v1/owners', {
      headers: { Origin: BASE_URL },
      data: { orgId, ownerType: 'individual', name: 'Guidance Owner' },
    });
    const owner = await ownerResponse.json();
    await page.request.post(`/api/v1/properties/${propertyId}/owners`, {
      headers: { Origin: BASE_URL },
      data: { ownerId: owner.owner.id, ownershipPct: 100 },
    });

    const unitId = await createUnit(page.request, propertyId, 'Unit A');

    await page.request.post('/api/v1/applications', {
      headers: { Origin: BASE_URL },
      data: { orgId, propertyId, unitId, applicantName: 'Guidance Applicant' },
    });

    await page.request.post('/api/v1/leases', {
      headers: { Origin: BASE_URL },
      data: { orgId, unitId, startDate: '2026-01-01', rentAmount: 5000, depositAmount: 0 },
    });

    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Finish setting up this property')).not.toBeVisible();
  });
});

test.describe('property photo upload', () => {
  test('uploads a photo, shows it as the cover, and removing it works', async ({ page }) => {
    const { orgId } = await setUpOrg(page.request, 'ui-photos');
    const propertyId = await createProperty(page.request, orgId, 'Photo Property');

    await page.goto(`/properties/${propertyId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Photos' }).click();

    // Minimal valid 1x1 PNG, generated in-memory -- no fixture file on disk needed.
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-photo.png',
      mimeType: 'image/png',
      buffer: onePixelPng,
    });

    await expect(page.getByText('Cover')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('No photos uploaded for this property yet.')).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('address autocomplete / manual fallback', () => {
  test('the address search field renders, and a property can still be created through manual entry alone', async ({
    page,
  }) => {
    await setUpOrg(page.request, 'ui-address');

    await page.goto('/properties/new');
    await page.waitForLoadState('networkidle');

    // Whether or not a Mapbox token is configured in this environment, the plain manual fields
    // must exist and be independently sufficient -- this is the actual invariant Stage 3 requires
    // ("do not make property creation impossible if autocomplete cannot find the address").
    await page.getByLabel('Property name').fill('Manual Entry Property');
    await page.getByLabel('Address line 1').fill('42 Manual Street');
    await page.getByLabel('City').fill('Johannesburg');

    await page.getByRole('button', { name: /create property/i }).click();
    await page.waitForURL(/\/properties\/[a-f0-9-]+$/, { timeout: 15_000 });
    await expect(page.getByText('Manual Entry Property')).toBeVisible();
  });
});
