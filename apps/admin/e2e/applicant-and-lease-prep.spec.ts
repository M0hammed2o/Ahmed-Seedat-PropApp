import { test, expect } from '@playwright/test';
import PizZip from 'pizzip';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit } from './fixtures/orgWorkflow';

// First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 16-18: real BROWSER-level
// verification of the applicant portal and lease-preparation UI -- not just their underlying APIs
// (already proven by property-lease-workflow.spec.ts). page.request shares cookies with page.goto
// (same pattern property-workflow-ui.spec.ts already established), so setUpOrg's staff session
// drives both API setup calls and real page navigations in the same browser context.

function realDocxWithPlaceholders(): Buffer {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>LEASE AGREEMENT</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Tenant: {{tenant_full_name}}</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Property: {{property_name}}, {{property_address}}</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Unit: {{unit_label}}</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Monthly rent: {{monthly_rent}}</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Start date: {{lease_start_date}}</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Landlord: {{landlord_name}}</w:t></w:r></w:p>' +
      '</w:body></w:document>',
  );
  return zip.generate({ type: 'nodebuffer' });
}

test.describe('applicant portal (real browser)', () => {
  test('a staff-issued application link renders a real, populated portal, accepts a document + OCR scan, and submits', async ({
    page,
  }) => {
    // Longer than the 60s default -- this is the first real browser hit on several brand-new
    // dev-mode routes (/apply/:token and its API routes), which Next.js JIT-compiles on first
    // request; not a sign of anything actually hanging (confirmed: a warm second run completes
    // each individual step in well under a second).
    test.setTimeout(180_000);

    const { orgId } = await setUpOrg(page.request, 'ui-applicant');
    const propertyId = await createProperty(page.request, orgId, 'Applicant UI Property');
    const unitId = await createUnit(page.request, propertyId, 'Unit A1');

    const applicationResponse = await page.request.post('/api/v1/applications', {
      headers: { Origin: BASE_URL },
      data: {
        orgId,
        propertyId,
        unitId,
        applicantName: 'Browser Test Applicant',
        applicantEmail: 'browser-applicant@example.com',
        selfService: true,
      },
    });
    expect(applicationResponse.ok()).toBe(true);
    const application = await applicationResponse.json();
    expect(application.application.status).toBe('invited');

    const tokenResponse = await page.request.post(
      `/api/v1/applications/${application.application.id}/access-tokens`,
      { headers: { Origin: BASE_URL }, data: { deliveryChannel: 'manual' } },
    );
    expect(tokenResponse.ok()).toBe(true);
    const { accessToken } = await tokenResponse.json();
    expect(accessToken.token).toBeTruthy();

    // === Real browser navigation to the public applicant link ===
    await page.goto(`/apply/${accessToken.token}`);

    // Correct property/unit context, no blank/dead page. Generous timeout on this first assertion
    // only -- a brand-new dev-mode route's first hit includes on-demand JIT compilation.
    await expect(page.getByRole('heading', { name: 'Rental application' })).toBeVisible({ timeout: 45000 });
    await expect(page.getByText(/Applicant UI Property/)).toBeVisible();
    await expect(page.getByText(/Unit A1/)).toBeVisible();

    // Required documents checklist present.
    await expect(page.getByText('Required documents')).toBeVisible();
    await expect(page.getByText('Copy of ID or passport')).toBeVisible();
    await expect(page.getByText('Proof of income (latest payslip')).toBeVisible();
    await expect(page.getByText('Proof of residential address')).toBeVisible();

    // Form fields present and fillable.
    await expect(page.getByText('Identity', { exact: true })).toBeVisible();
    await expect(page.getByText('Employment & income')).toBeVisible();
    await expect(page.getByText('Household')).toBeVisible();
    await expect(page.getByText('Consent', { exact: true })).toBeVisible();

    // === Upload the ID document (synthetic) ===
    const idRow = page.locator('li', { hasText: 'Copy of ID or passport' });
    const idFileInput = idRow.locator('input[type="file"]');
    await idFileInput.setInputFiles({
      name: 'id.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%synthetic id document\n%%EOF'),
    });
    await expect(idRow.getByText('Uploaded — awaiting review')).toBeVisible({ timeout: 15000 });

    // === Scan it (mock OCR) and apply a suggested value ===
    await idRow.getByRole('button', { name: 'Scan document' }).click();
    await expect(idRow.getByText(/OCR result: Mock Applicant/)).toBeVisible({ timeout: 15000 });
    await expect(idRow.getByText(/Confidence: \d+%/)).toBeVisible();
    await idRow.getByRole('button', { name: 'Use this value' }).first().click();

    // The applied value now appears in the form's Full legal name field.
    const nameInput = page.locator('label', { hasText: 'Full legal name' }).locator('input');
    await expect(nameInput).toHaveValue('Mock Applicant');

    // === Consent + submit ===
    await page.getByLabel(/I consent to my personal information/).check();
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByText(/Saved\. You can keep editing/)).toBeVisible({ timeout: 15000 });

    // === Server-side confirmation the submission actually landed ===
    const check = await page.request.get(`/api/v1/apply/${accessToken.token}`);
    const checked = await check.json();
    expect(checked.application.status).toBe('submitted');
    expect(checked.application.applicantName).toBe('Mock Applicant');
  });
});

test.describe('lease preparation (real browser)', () => {
  test('generating a lease from a template produces a real DOCX with merged content, visible end to end in the UI', async ({
    page,
  }) => {
    // Same first-compile reasoning as the applicant portal test above -- /leases/:id/prepare is
    // also a brand-new dev-mode route.
    test.setTimeout(180_000);

    const { orgId } = await setUpOrg(page.request, 'ui-lease-prep');
    const propertyId = await createProperty(page.request, orgId, 'Lease Prep UI Property');
    const unitId = await createUnit(page.request, propertyId, 'Unit B1');

    // A real lease template with {{merge_field}} placeholders, uploaded exactly like a manager would.
    const templateResponse = await page.request.post('/api/v1/lease-templates', {
      headers: { Origin: BASE_URL },
      multipart: {
        orgId,
        name: 'UI Test Template',
        file: {
          name: 'template.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: realDocxWithPlaceholders(),
        },
      },
    });
    expect(templateResponse.ok()).toBe(true);
    const template = await templateResponse.json();

    // Application -> approve -> draft lease (already-proven backend, real browser session).
    const applicationResponse = await page.request.post('/api/v1/applications', {
      headers: { Origin: BASE_URL },
      data: { orgId, propertyId, unitId, applicantName: 'Lease Prep UI Tenant', applicantEmail: 'lp-ui@example.com' },
    });
    const application = await applicationResponse.json();
    const decideResponse = await page.request.post(
      `/api/v1/applications/${application.application.id}/decide`,
      { headers: { Origin: BASE_URL }, data: { decision: 'approved' } },
    );
    const decided = await decideResponse.json();
    const leaseId = decided.leaseId as string;

    await page.request.patch(`/api/v1/leases/${leaseId}`, {
      headers: { Origin: BASE_URL },
      data: { rentAmount: 11500, depositAmount: 11500, startDate: '2026-10-01' },
    });

    // === Real browser navigation to the prepare-lease page ===
    await page.goto(`/leases/${leaseId}/prepare`);
    await expect(page.getByText(/Prepare lease/)).toBeVisible({ timeout: 45000 });
    await expect(page.getByText(/Lease Prep UI Property/)).toBeVisible();

    await page.getByLabel('Template').selectOption({ label: template.leaseTemplate.name as string });
    await page.getByLabel('Approved occupants').fill('Lease Prep UI Tenant');
    await page.getByLabel('Parking').fill('1 bay');

    await page.getByRole('button', { name: 'Generate lease draft' }).click();
    await expect(page.getByText('Lease generated.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/v1 — generated/)).toBeVisible();

    // === Download the real generated document and verify actual merged content ===
    const [download] = await Promise.all([
      page.waitForEvent('response', (r) => r.url().includes('/download') && r.ok()),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    const downloadBody = await download.json();
    expect(downloadBody.signedUrl).toBeTruthy();

    const fileResponse = await page.request.get(downloadBody.signedUrl);
    expect(fileResponse.ok()).toBe(true);
    const fileBuffer = Buffer.from(await fileResponse.body());
    const zip = new PizZip(fileBuffer);
    const documentXml = zip.file('word/document.xml')!.asText();
    expect(documentXml).toContain('Tenant: Lease Prep UI Tenant');
    expect(documentXml).toContain('Property: Lease Prep UI Property');
    expect(documentXml).toContain('Unit: Unit B1');
    expect(documentXml).toContain('Monthly rent: 11500');
    expect(documentXml).not.toContain('{{tenant_full_name}}');

    // === Review + send, visible in the UI ===
    await page.getByLabel(/I confirm the lease details/).check();
    await page.getByRole('button', { name: 'Confirm review' }).click();
    await expect(page.getByText(/Review recorded/)).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Send lease' }).click();
    await expect(page.getByText(/Lease sent/)).toBeVisible({ timeout: 15000 });

    // === Staff-confirmed-signed acceptance path, then activation ===
    await page.getByRole('button', { name: 'Record signed copy received' }).click();
    await expect(page.getByText(/Recorded — a signed copy was received/)).toBeVisible({ timeout: 15000 });

    await page.goto(`/leases/${leaseId}`);
    await page.getByRole('button', { name: 'Activate lease' }).click({ timeout: 30000 });

    // The click triggers an async fetch + router.refresh() -- poll rather than assume it has
    // landed server-side the instant .click() resolves.
    await expect
      .poll(
        async () => {
          const leaseCheck = await page.request.get(`/api/v1/leases/${leaseId}`);
          return (await leaseCheck.json()).lease.status;
        },
        { timeout: 15000 },
      )
      .toBe('active');

    const unitCheck = await page.request.get(`/api/v1/units/${unitId}`);
    const unitChecked = await unitCheck.json();
    expect(unitChecked.unit.status).toBe('occupied');
  });
});
