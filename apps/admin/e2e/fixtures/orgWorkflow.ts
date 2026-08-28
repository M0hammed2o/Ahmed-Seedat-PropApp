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
export async function activateTrialForTests(orgId: string): Promise<void> {
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

/** Creates an organization through the real API, then gives that synthetic E2E organization the
 * same commercially-ready state that the real PayFast completion webhook records in production. */
export async function createCommerciallyReadyOrganization(
  request: APIRequestContext,
  legalName: string,
): Promise<string> {
  const orgResponse = await request.post('/api/v1/organizations', {
    headers: { Origin: BASE_URL },
    data: { legalName, orgType: 'agency' },
  });
  expect(orgResponse.ok()).toBe(true);
  const org = (await orgResponse.json()) as { id: string };

  await activateTrialForTests(org.id);
  return org.id;
}

// Shared setup for the property/lease workflow E2E specs (workflow-integration pass,
// WORKLOG.md this date). Every one of these calls goes through the real API (not a direct
// Supabase client), same posture as onboarding.spec.ts -- exercises the real
// auth/CSRF/RLS/role-check path a browser session would hit, not a shortcut around it.

export interface WorkflowOrg {
  user: TestUser;
  orgId: string;
}

/** POST /api/v1/auth/signin is rate-limited at 10 attempts per 60s per-IP (packages/config's
 * RATE_LIMITS.loginAttemptsPerMinute, a real, intentional security control -- SECURITY.md's
 * credential-stuffing mitigation, never to be weakened for test convenience). This fixture is
 * called by nearly every spec in this suite; a full one-worker sequential run legitimately does
 * enough real password sign-ins from this machine's single local IP to occasionally cross that
 * real limit within its fixed 60s window -- reproduced live (v1 pre-deployment closeout,
 * WORKLOG.md this date): property-compliance-workflow.spec.ts's setUpOrg() calls got a real 429
 * partway through a full-suite run, never in isolation. The fix is the same one any correctly-
 * behaving rate-limited HTTP client uses -- back off and retry -- not raising or bypassing the
 * limit itself; check_rate_limit()'s fixed window means a retry after the window's remaining time
 * always succeeds once the count resets to 1. */
async function signIn(request: APIRequestContext, email: string, password: string) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await request.post('/api/v1/auth/signin', {
      headers: { Origin: BASE_URL },
      data: { email, password },
    });
    if (response.status() !== 429) {
      expect(response.ok()).toBe(true);
      return;
    }
    if (attempt === maxAttempts) {
      expect(response.ok()).toBe(true);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

/** Creates a confirmed user, completes consent/profile, and creates a fresh organization -- the
 * minimum state every property/lease workflow test needs before it can do anything else. */
export async function setUpOrg(request: APIRequestContext, label: string): Promise<WorkflowOrg> {
  const user = await createConfirmedTestUser(label);
  await signIn(request, user.email, user.password);
  await completeLegalConsentAndProfile(request);

  const orgId = await createCommerciallyReadyOrganization(
    request,
    `E2E ${label} Org ${Date.now()}`,
  );

  return { user, orgId };
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
