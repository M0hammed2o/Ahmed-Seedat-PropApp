import { expect, type APIRequestContext } from '@playwright/test';
import { BASE_URL } from '../../playwright.config';
import { createConfirmedTestUser, type TestUser } from './testUser';

// Property compliance workflow E2E fixtures (WORKLOG.md this date, Task 8). Mirrors
// orgWorkflow.ts's own "every call goes through the real API" posture for everything staff-side.
// Linking a tenant's auth user to their `tenants` row is the one deliberate exception: done via a
// direct service-role REST PATCH rather than driving the real invitation-accept UI flow, because
// invitation acceptance already has its own dedicated, previously-verified coverage
// (tenant onboarding audit/completion passes) -- these scenarios are about compliance-requirement
// visibility/acknowledgement once a tenant is linked, not about re-proving invitation mechanics.

const SUPABASE_URL = 'http://127.0.0.1:54321';

export interface TestTenant {
  user: TestUser;
  tenantId: string;
}

async function serviceRolePatch(path: string, body: unknown) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Service-role PATCH ${path} failed (${res.status}): ${await res.text()}`);
  }
}

/** Creates a real tenants row (staff session, real API) with a real confirmed auth user linked to
 * it directly via service role -- the tenant can immediately sign in and see this tenancy,
 * without going through /activate. */
export async function createLinkedTenant(
  request: APIRequestContext,
  orgId: string,
  label: string,
  fullName: string,
): Promise<TestTenant> {
  const user = await createConfirmedTestUser(label);

  const tenantResponse = await request.post('/api/v1/tenants', {
    headers: { Origin: BASE_URL },
    data: { orgId, fullName, email: user.email },
  });
  expect(tenantResponse.ok()).toBe(true);
  const tenantBody = await tenantResponse.json();
  const tenantId = tenantBody.tenant.id as string;

  await serviceRolePatch(`/rest/v1/tenants?id=eq.${tenantId}`, { user_id: user.id });

  return { user, tenantId };
}

export async function createActiveLeaseForTenant(
  request: APIRequestContext,
  orgId: string,
  unitId: string,
  tenantId: string,
): Promise<string> {
  const leaseResponse = await request.post('/api/v1/leases', {
    headers: { Origin: BASE_URL },
    data: { orgId, unitId, startDate: '2026-01-01', rentAmount: 9000, depositAmount: 0 },
  });
  expect(leaseResponse.ok()).toBe(true);
  const lease = await leaseResponse.json();
  const leaseId = lease.lease.id as string;

  await request.post(`/api/v1/leases/${leaseId}/tenants`, {
    headers: { Origin: BASE_URL },
    data: { tenantId, isPrimary: true },
  });

  const activateResponse = await request.post(`/api/v1/leases/${leaseId}/activate`, {
    headers: { Origin: BASE_URL },
  });
  expect(activateResponse.ok()).toBe(true);

  return leaseId;
}

// A minimal, syntactically-valid single-page PDF -- real bytes, not a text file mislabeled as
// PDF, so the ALLOWED_MIME_TYPES/malware-scan pipeline treats it exactly like a genuine upload.
// Content is fictional/synthetic (per this task's own instruction never to use real reference
// material) -- the actual OCR text is irrelevant here since local/CI has no real vendor
// credentials, so extraction always runs through MockDocumentIntelligenceProvider regardless.
function syntheticPdfBuffer(label: string): Buffer {
  const text = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj
4 0 obj<</Length 44>>stream
BT /F1 12 Tf 20 100 Td (${label}) Tj ET
endstream
endobj
trailer<</Size 4/Root 1 0 R>>
%%EOF`;
  return Buffer.from(text, 'utf-8');
}

export async function uploadComplianceDocument(
  request: APIRequestContext,
  orgId: string,
  propertyId: string,
  fileLabel: string,
): Promise<string> {
  const categoriesResponse = await request.get('/api/v1/document-categories');
  expect(categoriesResponse.ok()).toBe(true);
  const categoriesBody = await categoriesResponse.json();
  const category = (categoriesBody.categories as { slug: string; id: string }[]).find(
    (c) => c.slug === 'compliance_documents',
  );
  if (!category) throw new Error('compliance_documents category not found');

  const uploadResponse = await request.post('/api/v1/documents', {
    headers: { Origin: BASE_URL },
    multipart: {
      file: {
        name: `${fileLabel}.pdf`,
        mimeType: 'application/pdf',
        buffer: syntheticPdfBuffer(fileLabel),
      },
      orgId,
      propertyId,
      categoryId: category.id,
      documentType: 'supporting_document',
    },
  });
  expect(uploadResponse.ok()).toBe(true);
  const body = await uploadResponse.json();
  return body.document.id as string;
}

export async function uploadLevyDocument(
  request: APIRequestContext,
  orgId: string,
  propertyId: string,
  fileLabel: string,
): Promise<string> {
  const categoriesResponse = await request.get('/api/v1/document-categories');
  const categoriesBody = await categoriesResponse.json();
  const category = (categoriesBody.categories as { slug: string; id: string }[]).find(
    (c) => c.slug === 'levies',
  );
  if (!category) throw new Error('levies category not found');

  const uploadResponse = await request.post('/api/v1/documents', {
    headers: { Origin: BASE_URL },
    multipart: {
      file: {
        name: `${fileLabel}.pdf`,
        mimeType: 'application/pdf',
        buffer: syntheticPdfBuffer(fileLabel),
      },
      orgId,
      propertyId,
      categoryId: category.id,
      documentType: 'statement',
    },
  });
  expect(uploadResponse.ok()).toBe(true);
  const body = await uploadResponse.json();
  return body.document.id as string;
}

export async function createRule(
  request: APIRequestContext,
  propertyId: string,
  title: string,
): Promise<string> {
  const response = await request.post(`/api/v1/properties/${propertyId}/rules`, {
    headers: { Origin: BASE_URL },
    data: { category: 'conduct_rules', title },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return body.ruleId as string;
}

export async function createAndActivateRuleVersion(
  request: APIRequestContext,
  ruleId: string,
  documentId: string,
  effectiveDate: string,
): Promise<{ versionId: string; requirementsAssigned: number }> {
  const versionResponse = await request.post(`/api/v1/property-rules/${ruleId}/versions`, {
    headers: { Origin: BASE_URL },
    data: { documentId, effectiveDate },
  });
  expect(versionResponse.ok()).toBe(true);
  const versionBody = await versionResponse.json();
  const versionId = versionBody.versionId as string;

  const activateResponse = await request.post(
    `/api/v1/property-rule-versions/${versionId}/activate`,
    { headers: { Origin: BASE_URL } },
  );
  expect(activateResponse.ok()).toBe(true);
  const activateBody = await activateResponse.json();

  return { versionId, requirementsAssigned: activateBody.requirementsAssigned as number };
}
