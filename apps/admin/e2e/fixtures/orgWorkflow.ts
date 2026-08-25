import { expect, type APIRequestContext } from '@playwright/test';
import { BASE_URL } from '../../playwright.config';
import { createConfirmedTestUser, type TestUser } from './testUser';
import { completeLegalConsentAndProfile } from './onboarding';

const SUPABASE_URL = 'http://127.0.0.1:54321';

// A freshly created org is gated behind "complete payment-method setup before adding properties"
// (commercial_setup_required -- apps/admin/lib/onboarding.ts) in real production use; in
// production this clears via activate_trial_after_payment(), called from the real PayFast
// checkout-completion webhook (apps/admin/lib/billing.ts). This fixture predates that gate (found
// live: every test in this file was failing at createProperty with 403
// commercial_setup_required, reproduced identically against the file's own pre-existing,
// unmodified version -- not a regression from other work). Simulating a real PayFast round trip
// isn't practical for local/CI E2E, so this calls the same RPC the webhook itself calls, via the
// service-role key the other fixtures in this file already use for admin-API test setup
// (testUser.ts) -- the same "seed via API, test everything after via real UI/API" boundary, not a
// new kind of shortcut.
async function activateTrialForTests(orgId: string): Promise<void> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set -- cannot activate trial for E2E setup.');
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/activate_trial_after_payment`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_org_id: orgId }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to activate trial for E2E org ${orgId} (${response.status}): ${body}`);
  }
}

// Shared setup for the property/lease workflow E2E specs (workflow-integration pass,
// WORKLOG.md this date). Every one of these calls goes through the real API (not a direct
// Supabase client), same posture as onboarding.spec.ts -- exercises the real
// auth/CSRF/RLS/role-check path a browser session would hit, not a shortcut around it.

export interface WorkflowOrg {
  user: TestUser;
  orgId: string;
}

async function signIn(request: APIRequestContext, email: string, password: string) {
  const response = await request.post('/api/v1/auth/signin', {
    headers: { Origin: BASE_URL },
    data: { email, password },
  });
  expect(response.ok()).toBe(true);
}

/** Creates a confirmed user, completes consent/profile, and creates a fresh organization -- the
 * minimum state every property/lease workflow test needs before it can do anything else. */
export async function setUpOrg(request: APIRequestContext, label: string): Promise<WorkflowOrg> {
  const user = await createConfirmedTestUser(label);
  await signIn(request, user.email, user.password);
  await completeLegalConsentAndProfile(request);

  const orgResponse = await request.post('/api/v1/organizations', {
    headers: { Origin: BASE_URL },
    data: { legalName: `E2E ${label} Org ${Date.now()}`, orgType: 'agency' },
  });
  expect(orgResponse.ok()).toBe(true);
  const org = await orgResponse.json();

  await activateTrialForTests(org.id as string);

  return { user, orgId: org.id as string };
}

export async function createProperty(
  request: APIRequestContext,
  orgId: string,
  nickname: string,
): Promise<string> {
  const response = await request.post('/api/v1/properties', {
    headers: { Origin: BASE_URL },
    data: {
      orgId,
      nickname,
      addressLine1: '1 Test Street',
      city: 'Cape Town',
      propertyType: 'apartment',
      country: 'ZA',
    },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return body.property.id as string;
}

export async function createUnit(
  request: APIRequestContext,
  propertyId: string,
  unitLabel: string,
): Promise<string> {
  const response = await request.post(`/api/v1/properties/${propertyId}/units`, {
    headers: { Origin: BASE_URL },
    data: { unitLabel },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return body.unit.id as string;
}

export async function getUnitStatus(request: APIRequestContext, unitId: string): Promise<string> {
  const response = await request.get(`/api/v1/units/${unitId}`);
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return body.unit.status as string;
}
