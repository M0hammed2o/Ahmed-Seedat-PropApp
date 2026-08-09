import { expect, type APIRequestContext } from '@playwright/test';
import { BASE_URL } from '../../playwright.config';
import { createConfirmedTestUser, type TestUser } from './testUser';
import { completeLegalConsentAndProfile } from './onboarding';

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
