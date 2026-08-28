import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// V1 launch-completion pass (WORKLOG.md this date): real-local-Supabase integration coverage for
// notifyPropertyStaff() wired into POST /api/v1/maintenance-tickets (lib/notify.ts). Proves the
// full round trip -- role-qualified + property-access-qualified staff actually receive a
// `notifications` row scoped to the real property, the creating actor is excluded (excludeUserId),
// and a colleague with org role but no property_access grant on THIS property is excluded too
// (RLS/tenant-isolation safety: a notification must never be sent to someone without real access
// to the record). Mirrors applications/[id]/access-tokens/__tests__/route.test.ts's setup shape.

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

const { POST } = await import('../route');

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

function createTicketRequest(body: unknown) {
  return new NextRequest('http://localhost/api/v1/maintenance-tickets', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describeIfSupabase(
  'POST /api/v1/maintenance-tickets notification side-effect (real local Supabase integration)',
  () => {
    const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let orgId: string;
    let propertyId: string;
    let unitId: string;
    let managerId: string;
    let scopedStaffId: string;
    let unscopedStaffId: string;

    beforeEach(async () => {
      mockCookieJar.clear();
      const email = `maint-notify-manager-${Date.now()}@propertyvault.example`;
      const password = 'TestPassw0rd!23';
      const created = await adminFetch('/auth/v1/admin/users', { email, password, email_confirm: true });
      managerId = created.id;

      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const tokenBody = await tokenRes.json();
      mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

      const orgRows = await adminFetch('/rest/v1/organizations', {
        legal_name: `Maint Notify Vitest Org ${Date.now()}`,
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

      const { data: property } = await serviceClient
        .from('properties')
        .insert({
          org_id: orgId,
          nickname: 'Maint Notify Property',
          address_line1: '1 Test St',
          city: 'Cape Town',
          country: 'ZA',
          property_type: 'house',
        })
        .select('id')
        .single();
      propertyId = property!.id;

      const { data: unit } = await serviceClient
        .from('units')
        .insert({ property_id: propertyId, org_id: orgId, unit_label: 'U1', status: 'vacant' })
        .select('id')
        .single();
      unitId = unit!.id;

      // Scoped staff: org role agent+ AND holds a property_access grant on THIS property --
      // must receive the notification.
      const scopedAuth = await adminFetch('/auth/v1/admin/users', {
        email: `maint-notify-scoped-${Date.now()}@propertyvault.example`,
        password,
        email_confirm: true,
      });
      scopedStaffId = scopedAuth.id;
      await adminFetch('/rest/v1/organization_members', {
        org_id: orgId,
        user_id: scopedStaffId,
        role: 'agent',
        status: 'active',
        joined_at: new Date().toISOString(),
      });
      await serviceClient
        .from('property_access')
        .insert({ property_id: propertyId, user_id: scopedStaffId, property_role: 'administrator' });

      // Unscoped staff: org role agent+ but NO property_access grant on this property -- must be
      // excluded (RLS/tenant-isolation safety: no real access to this specific property).
      //
      // grant_new_member_property_access_trigger (migration 20260101000064) auto-grants
      // 'administrator' property_access to EVERY active org member on EVERY existing property in
      // the org the instant they join -- a real, documented, intentional codebase invariant ("any
      // active org member sees every property in their org", that migration's own comment) that
      // fires here too. Simply adding this member without an explicit property_access insert does
      // NOT produce an unscoped user -- the trigger grants it anyway. The explicit delete below
      // (mirroring what revoke_property_access() does at the SQL level, but via service-role
      // directly since that RPC requires a real authenticated principal-role caller this test
      // fixture doesn't set up) is what actually constructs the "org member, no property access"
      // state this test needs -- confirmed necessary by first running this test without it and
      // observing both scoped and unscoped staff receive the notification.
      const unscopedAuth = await adminFetch('/auth/v1/admin/users', {
        email: `maint-notify-unscoped-${Date.now()}@propertyvault.example`,
        password,
        email_confirm: true,
      });
      unscopedStaffId = unscopedAuth.id;
      await adminFetch('/rest/v1/organization_members', {
        org_id: orgId,
        user_id: unscopedStaffId,
        role: 'agent',
        status: 'active',
        joined_at: new Date().toISOString(),
      });
      await serviceClient
        .from('property_access')
        .delete()
        .eq('property_id', propertyId)
        .eq('user_id', unscopedStaffId);
    });

    afterEach(async () => {
      mockAuthorizationHeader = null;
      await serviceClient.from('notifications').delete().eq('related_entity_type', 'maintenance_ticket');
      await serviceClient.from('maintenance_tickets').delete().eq('org_id', orgId);
      await serviceClient.from('property_access').delete().eq('property_id', propertyId);
      await serviceClient.from('units').delete().eq('id', unitId);
      await serviceClient.from('properties').delete().eq('id', propertyId);
      await serviceClient.from('organizations').delete().eq('id', orgId);
      await serviceClient.auth.admin.deleteUser(managerId);
      await serviceClient.auth.admin.deleteUser(scopedStaffId);
      await serviceClient.auth.admin.deleteUser(unscopedStaffId);
    });

    it('notifies only the property-access-scoped staff member, excluding the creating actor and the unscoped colleague', async () => {
      const response = await POST(
        createTicketRequest({
          orgId,
          propertyId,
          unitId,
          summary: 'Leaking tap in kitchen',
          priority: 'high',
        }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      const ticketId = body.maintenanceTicket.id;
      expect(ticketId).toBeTruthy();

      const { data: notifications } = await serviceClient
        .from('notifications')
        .select('user_id, type, related_entity_type, related_entity_id')
        .eq('related_entity_type', 'maintenance_ticket')
        .eq('related_entity_id', ticketId);

      expect(notifications).toHaveLength(1);
      expect(notifications?.[0]?.user_id).toBe(scopedStaffId);
      expect(notifications?.[0]?.type).toBe('maintenance_ticket_created');

      const recipientIds = notifications!.map((n) => n.user_id);
      expect(recipientIds).not.toContain(managerId);
      expect(recipientIds).not.toContain(unscopedStaffId);
    });
  },
);
