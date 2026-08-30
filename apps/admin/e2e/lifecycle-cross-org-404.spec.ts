import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit } from './fixtures/orgWorkflow';
import { createConfirmedTestUser } from './fixtures/testUser';

// Final local hardening pass (WORKLOG.md this date), Objective 1: the property/unit lifecycle
// routes added in Phase H (archive/restore/hard-delete/deletion-eligibility) called their RPC
// directly with no prior RLS-scoped visibility check, so a cross-org caller got a permission
// error instead of the API_SPEC.md §0 "a resource in another org 404s, never 403, so org
// existence isn't leaked by status code" convention every other resource route already follows
// (see properties/[id]/route.ts's own GET/PATCH). This spec proves the fix at the real HTTP layer
// -- the fix lives in the route files, not in the RPCs, so a Vitest RPC-level test (which bypasses
// the route entirely) cannot prove it; only a real request through the real route can.

const SUPABASE_URL = 'http://127.0.0.1:54321';

interface ErrorShape {
  status: number;
  code: string;
}

async function errorShape(response: {
  status(): number;
  json(): Promise<{ error?: { code?: string } }>;
}): Promise<ErrorShape> {
  const body = await response.json();
  return { status: response.status(), code: body.error?.code ?? '' };
}

/** Directly inserts an organization_members row via the service-role REST API, same raw-fetch
 * setup pattern orgWorkflow.ts's activateTrialForTests() already uses -- mirrors what a real
 * accepted invitation would produce, without driving the whole invite UI for a role that's
 * otherwise incidental to what this spec is proving. */
async function addOrgMember(orgId: string, userId: string, role: string): Promise<void> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set -- cannot seed an org member for this test.');
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/organization_members`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      org_id: orgId,
      user_id: userId,
      role,
      status: 'active',
      joined_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to seed org member (${response.status}): ${await response.text()}`);
  }
}

async function signIn(request: APIRequestContext, email: string, password: string): Promise<void> {
  const response = await request.post('/api/v1/auth/signin', {
    headers: { Origin: BASE_URL },
    data: { email, password },
  });
  expect(response.ok()).toBe(true);
}

test.describe('property/unit lifecycle routes: cross-org resource hiding', () => {
  test('a nonexistent property returns the same 404 shape on archive/restore/hard-delete/deletion-eligibility', async ({
    request,
  }) => {
    await setUpOrg(request, 'lifecycle-404-nonexistent-property');
    const fakeId = randomUUID();

    const archive = await errorShape(
      await request.delete(`/api/v1/properties/${fakeId}`, { headers: { Origin: BASE_URL } }),
    );
    const restore = await errorShape(
      await request.post(`/api/v1/properties/${fakeId}/restore`, { headers: { Origin: BASE_URL } }),
    );
    const hardDelete = await errorShape(
      await request.post(`/api/v1/properties/${fakeId}/hard-delete`, { headers: { Origin: BASE_URL } }),
    );
    const eligibility = await errorShape(await request.get(`/api/v1/properties/${fakeId}/deletion-eligibility`));

    for (const shape of [archive, restore, hardDelete, eligibility]) {
      expect(shape.status).toBe(404);
      expect(shape.code).toBe('not_found');
    }
  });

  test('a property in another org returns the exact same 404 shape/status as a nonexistent one, on every lifecycle route', async ({
    request,
  }) => {
    const orgA = await setUpOrg(request, 'lifecycle-404-crossorg-property-a');
    const propertyId = await createProperty(request, orgA.orgId, 'Org A Property');

    // Switch sessions to a brand-new, unrelated org/user -- same technique
    // property-lease-workflow.spec.ts's own isolation test already uses.
    await setUpOrg(request, 'lifecycle-404-crossorg-property-b');

    const archive = await errorShape(
      await request.delete(`/api/v1/properties/${propertyId}`, { headers: { Origin: BASE_URL } }),
    );
    const restore = await errorShape(
      await request.post(`/api/v1/properties/${propertyId}/restore`, { headers: { Origin: BASE_URL } }),
    );
    const hardDelete = await errorShape(
      await request.post(`/api/v1/properties/${propertyId}/hard-delete`, { headers: { Origin: BASE_URL } }),
    );
    const eligibility = await errorShape(
      await request.get(`/api/v1/properties/${propertyId}/deletion-eligibility`),
    );

    for (const shape of [archive, restore, hardDelete, eligibility]) {
      expect(shape.status).toBe(404);
      expect(shape.code).toBe('not_found');
    }

    // The property itself must be completely unaffected by the cross-org caller's attempts.
    await setUpOrg(request, 'lifecycle-404-crossorg-property-verify');
  });

  test('a nonexistent unit returns the same 404 shape on archive/restore/hard-delete/deletion-eligibility', async ({
    request,
  }) => {
    await setUpOrg(request, 'lifecycle-404-nonexistent-unit');
    const fakeId = randomUUID();

    const archive = await errorShape(
      await request.post(`/api/v1/units/${fakeId}/archive`, { headers: { Origin: BASE_URL } }),
    );
    const restore = await errorShape(
      await request.post(`/api/v1/units/${fakeId}/restore`, { headers: { Origin: BASE_URL } }),
    );
    const hardDelete = await errorShape(
      await request.post(`/api/v1/units/${fakeId}/hard-delete`, { headers: { Origin: BASE_URL } }),
    );
    const eligibility = await errorShape(await request.get(`/api/v1/units/${fakeId}/deletion-eligibility`));

    for (const shape of [archive, restore, hardDelete, eligibility]) {
      expect(shape.status).toBe(404);
      expect(shape.code).toBe('not_found');
    }
  });

  test('a unit in another org returns the exact same 404 shape/status as a nonexistent one, on every lifecycle route', async ({
    request,
  }) => {
    const orgA = await setUpOrg(request, 'lifecycle-404-crossorg-unit-a');
    const propertyId = await createProperty(request, orgA.orgId, 'Org A Property');
    const unitId = await createUnit(request, propertyId, 'Unit A');

    await setUpOrg(request, 'lifecycle-404-crossorg-unit-b');

    const archive = await errorShape(
      await request.post(`/api/v1/units/${unitId}/archive`, { headers: { Origin: BASE_URL } }),
    );
    const restore = await errorShape(
      await request.post(`/api/v1/units/${unitId}/restore`, { headers: { Origin: BASE_URL } }),
    );
    const hardDelete = await errorShape(
      await request.post(`/api/v1/units/${unitId}/hard-delete`, { headers: { Origin: BASE_URL } }),
    );
    const eligibility = await errorShape(await request.get(`/api/v1/units/${unitId}/deletion-eligibility`));

    for (const shape of [archive, restore, hardDelete, eligibility]) {
      expect(shape.status).toBe(404);
      expect(shape.code).toBe('not_found');
    }
  });

  test('a same-org member with insufficient role gets a real permission response (never a 404) once the resource is visible', async ({
    request,
  }) => {
    const orgA = await setUpOrg(request, 'lifecycle-perm-visible-a');
    const propertyId = await createProperty(request, orgA.orgId, 'Org A Property');

    // A second, real org member -- 'agent' has org-level write access (sees/edits the property
    // fine) but hard_delete_property() requires principal, so this must be a genuine permission
    // denial, not a visibility failure.
    const agentUser = await createConfirmedTestUser('lifecycle-perm-agent');
    await addOrgMember(orgA.orgId, agentUser.id, 'agent');
    await signIn(request, agentUser.email, agentUser.password);

    const hardDeleteResponse = await request.post(`/api/v1/properties/${propertyId}/hard-delete`, {
      headers: { Origin: BASE_URL },
    });
    // Never a 404 -- the agent CAN see this property, they just aren't allowed to hard-delete it.
    expect(hardDeleteResponse.status()).not.toBe(404);
    expect(hardDeleteResponse.ok()).toBe(false);
    const hardDeleteBody = await hardDeleteResponse.json();
    expect(hardDeleteBody.error.code).not.toBe('not_found');

    // The property is still there and still visible to the agent (proves this really was a
    // permission denial, not a hidden/missing resource).
    const getResponse = await request.get(`/api/v1/properties/${propertyId}`);
    expect(getResponse.ok()).toBe(true);
  });

  test('same-org principal/owner paths are unaffected by the visibility check: property and unit archive/restore/hard-delete still work end to end', async ({
    request,
  }) => {
    const orgA = await setUpOrg(request, 'lifecycle-perm-happy-path');
    const propertyId = await createProperty(request, orgA.orgId, 'Empty Test Property');

    const archiveResponse = await request.delete(`/api/v1/properties/${propertyId}`, {
      headers: { Origin: BASE_URL },
    });
    expect(archiveResponse.ok()).toBe(true);
    const restoreResponse = await request.post(`/api/v1/properties/${propertyId}/restore`, {
      headers: { Origin: BASE_URL },
    });
    expect(restoreResponse.ok()).toBe(true);

    const eligibilityResponse = await request.get(`/api/v1/properties/${propertyId}/deletion-eligibility`);
    expect(eligibilityResponse.ok()).toBe(true);
    const eligibility = await eligibilityResponse.json();
    expect(eligibility.eligible).toBe(true);

    const hardDeleteResponse = await request.post(`/api/v1/properties/${propertyId}/hard-delete`, {
      headers: { Origin: BASE_URL },
    });
    expect(hardDeleteResponse.ok()).toBe(true);

    // Same round trip for a unit, on a second, sibling property.
    const property2Id = await createProperty(request, orgA.orgId, 'Unit Host Property');
    const unitId = await createUnit(request, property2Id, 'Unit A');

    const unitArchiveResponse = await request.post(`/api/v1/units/${unitId}/archive`, {
      headers: { Origin: BASE_URL },
    });
    expect(unitArchiveResponse.ok()).toBe(true);
    const unitRestoreResponse = await request.post(`/api/v1/units/${unitId}/restore`, {
      headers: { Origin: BASE_URL },
    });
    expect(unitRestoreResponse.ok()).toBe(true);
    const unitHardDeleteResponse = await request.post(`/api/v1/units/${unitId}/hard-delete`, {
      headers: { Origin: BASE_URL },
    });
    expect(unitHardDeleteResponse.ok()).toBe(true);
  });
});
