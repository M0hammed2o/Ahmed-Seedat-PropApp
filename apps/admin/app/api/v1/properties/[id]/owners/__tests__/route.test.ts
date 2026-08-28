import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Property owners relationship-management pass (V1 launch-completion, this date): the new DELETE
// route (../[ownerId]/route.ts) removes only a property_owners RELATIONSHIP row, never the owners
// identity row, and is gated on the same org agent+ role the sibling POST handler in this same
// route family already requires (see ../route.ts). Same real-local-Supabase integration pattern as
// apps/admin/app/api/v1/applications/[id]/access-tokens/__tests__/route.test.ts -- no prior test
// file existed for this route family before this pass.

let mockAuthorizationHeader: string | null = null;
const mockCookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null),
  }),
  cookies: async () => ({
    get: (name: string) => (mockCookieJar.has(name) ? { value: mockCookieJar.get(name) } : undefined),
    set: (name: string, value: string) => {
      mockCookieJar.set(name, value);
    },
    getAll: () => [],
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { DELETE } = await import('../[ownerId]/route');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

async function adminFetch(path: string, body: unknown, method = 'POST') {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function signIn(email: string, password: string) {
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const tokenBody = await tokenRes.json();
  return tokenBody.access_token as string;
}

function deleteRequest(propertyId: string, ownerId: string) {
  return new NextRequest(
    `http://localhost/api/v1/properties/${propertyId}/owners/${ownerId}`,
    { method: 'DELETE' },
  );
}

describeIfSupabase('DELETE /api/v1/properties/:id/owners/:ownerId (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let ownerId: string;
  let managerId: string;
  let managerToken: string;
  let viewerId: string;
  let viewerToken: string;
  const password = 'TestPassw0rd!23';

  beforeEach(async () => {
    mockCookieJar.clear();
    const suffix = Date.now();

    const managerEmail = `owners-delete-manager-${suffix}@propertyvault.example`;
    const managerCreated = await adminFetch('/auth/v1/admin/users', {
      email: managerEmail,
      password,
      email_confirm: true,
    });
    managerId = managerCreated.id;
    managerToken = await signIn(managerEmail, password);

    const viewerEmail = `owners-delete-viewer-${suffix}@propertyvault.example`;
    const viewerCreated = await adminFetch('/auth/v1/admin/users', {
      email: viewerEmail,
      password,
      email_confirm: true,
    });
    viewerId = viewerCreated.id;
    viewerToken = await signIn(viewerEmail, password);

    const orgRows = await adminFetch('/rest/v1/organizations', {
      legal_name: `Owners Delete Vitest Org ${suffix}`,
      org_type: 'agency',
    });
    orgId = orgRows[0].id;
    await adminFetch('/rest/v1/organization_members', {
      org_id: orgId,
      user_id: managerId,
      role: 'manager',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    // Below the agent+ floor every property_owners write requires -- used for the forbidden case.
    // property_access_mode defaults to 'all', so this member still automatically holds
    // 'administrator' property_access (via grant_new_member_property_access); the org-role check
    // is the one this isolates.
    await adminFetch('/rest/v1/organization_members', {
      org_id: orgId,
      user_id: viewerId,
      role: 'viewer',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    const { data: property } = await serviceClient
      .from('properties')
      .insert({
        org_id: orgId,
        nickname: 'Owners Delete Property',
        address_line1: '1 Test St',
        city: 'Cape Town',
        country: 'ZA',
        property_type: 'house',
      })
      .select('id')
      .single();
    propertyId = property!.id;
    // Manager needs explicit property-level owner/administrator access too (grant_org_members_
    // property_access only backfills at property-creation time for members that already existed --
    // the manager did exist before this insert, so the trigger already covers it, but this keeps
    // the test's intent explicit and independent of trigger-timing details).
    await serviceClient
      .from('property_access')
      .upsert(
        { property_id: propertyId, user_id: managerId, property_role: 'administrator', granted_by: managerId },
        { onConflict: 'property_id,user_id' },
      );

    const { data: owner } = await serviceClient
      .from('owners')
      .insert({ org_id: orgId, name: 'Delete Test Owner', owner_type: 'individual' })
      .select('id')
      .single();
    ownerId = owner!.id;

    await serviceClient
      .from('property_owners')
      .insert({ property_id: propertyId, owner_id: ownerId, ownership_pct: 100 });
  });

  afterEach(async () => {
    mockAuthorizationHeader = null;
    await serviceClient.from('audit_events').delete().eq('org_id', orgId);
    await serviceClient.from('property_owners').delete().eq('property_id', propertyId);
    await serviceClient.from('owners').delete().eq('id', ownerId);
    await serviceClient.from('property_access').delete().eq('property_id', propertyId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(managerId);
    await serviceClient.auth.admin.deleteUser(viewerId);
  });

  it('removes only the property_owners relationship row, never the owners identity row', async () => {
    mockAuthorizationHeader = `Bearer ${managerToken}`;
    const response = await DELETE(deleteRequest(propertyId, ownerId), {
      params: Promise.resolve({ id: propertyId, ownerId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(true);

    const { data: relationship } = await serviceClient
      .from('property_owners')
      .select('owner_id')
      .eq('property_id', propertyId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    expect(relationship).toBeNull();

    const { data: identity } = await serviceClient
      .from('owners')
      .select('id')
      .eq('id', ownerId)
      .maybeSingle();
    expect(identity).not.toBeNull();
  });

  it('writes a property.ownership_removed audit event', async () => {
    mockAuthorizationHeader = `Bearer ${managerToken}`;
    await DELETE(deleteRequest(propertyId, ownerId), {
      params: Promise.resolve({ id: propertyId, ownerId }),
    });

    const { count } = await serviceClient
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', propertyId)
      .eq('action', 'property.ownership_removed');
    expect(count).toBe(1);
  });

  it('rejects a caller below the agent+ role floor with 403, and leaves the relationship intact', async () => {
    mockAuthorizationHeader = `Bearer ${viewerToken}`;
    const response = await DELETE(deleteRequest(propertyId, ownerId), {
      params: Promise.resolve({ id: propertyId, ownerId }),
    });
    expect(response.status).toBe(403);

    const { data: relationship } = await serviceClient
      .from('property_owners')
      .select('owner_id')
      .eq('property_id', propertyId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    expect(relationship).not.toBeNull();
  });

  it('returns 404 for a relationship that does not exist', async () => {
    mockAuthorizationHeader = `Bearer ${managerToken}`;
    const { data: otherOwner } = await serviceClient
      .from('owners')
      .insert({ org_id: orgId, name: 'Never Attached Owner', owner_type: 'individual' })
      .select('id')
      .single();

    const response = await DELETE(deleteRequest(propertyId, otherOwner!.id), {
      params: Promise.resolve({ id: propertyId, ownerId: otherOwner!.id }),
    });
    expect(response.status).toBe(404);

    await serviceClient.from('owners').delete().eq('id', otherOwner!.id);
  });

  it('returns 401 when the caller is not authenticated', async () => {
    mockAuthorizationHeader = null;
    const response = await DELETE(deleteRequest(propertyId, ownerId), {
      params: Promise.resolve({ id: propertyId, ownerId }),
    });
    expect(response.status).toBe(401);
  });
});
