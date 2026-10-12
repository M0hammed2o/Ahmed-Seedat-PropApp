import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Tenant journey: view an approved utility statement -> raise a dispute. The dispute opens on that statement's own
// charges (blocking invoicing), never changes an amount, notifies staff, and another tenant cannot touch it.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

let mockAuthorizationHeader: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (n: string) => (n.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null) }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, getAll: () => [] }),
}));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
delete process.env.RESEND_API_KEY;
delete process.env.SMART_UTILITY_TENANT_STATEMENTS_ENABLED;

const { POST } = await import('../route');
const billing = await import('@/lib/smartUtility/billing');
const statements = await import('@/lib/smartUtility/statements');
const { sastInstant } = await import('@/lib/smartUtility/consumption');

const URL_ = 'http://127.0.0.1:54321';
let reachable = false;
try {
  reachable = (await fetch(`${URL_}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const d = reachable ? describe : describe.skip;
const service: SupabaseClient = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const token = async (email: string) =>
  (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'TestPassw0rd!23' }) })).json()).access_token as string;
const call = (id: string, body: unknown) => POST(new NextRequest('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

d('tenant utility dispute (real local Supabase)', () => {
  it('opens a dispute on the tenant\'s own charges only, blocks invoicing, keeps amounts, notifies staff', async () => {
    const sfx = Date.now();
    const user = async (tag: string) => {
      const email = `disp-${tag}-${sfx}@propertyvault.example`;
      const id = (await service.auth.admin.createUser({ email, password: 'TestPassw0rd!23', email_confirm: true })).data.user!.id;
      return { id, email };
    };
    const staff = await user('staff');
    const tenantA = await user('a');
    const tenantB = await user('b');
    const ins = async (table: string, row: Record<string, unknown>) => (await service.from(table).insert(row).select('id').single()).data!.id as string;
    const orgId = await ins('organizations', { legal_name: `DISP ${sfx}`, org_type: 'agency', utilities_enabled: true });
    await service.from('organization_members').insert({ org_id: orgId, user_id: staff.id, role: 'accountant', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    const P = await ins('properties', { org_id: orgId, nickname: 'Dispute Court', address_line1: '1', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' });
    const flat = async (label: string, tenantUser: string) => {
      const unit = await ins('units', { org_id: orgId, property_id: P, unit_label: label });
      const tenant = await ins('tenants', { org_id: orgId, full_name: `Tenant ${label}`, status: 'active', user_id: tenantUser });
      const lease = await ins('leases', { org_id: orgId, unit_id: unit, start_date: '2026-01-01', rent_amount: 6000, status: 'active' });
      await service.from('lease_tenants').insert({ lease_id: lease, tenant_id: tenant, is_primary: true });
      const meter = await ins('utility_meters', { org_id: orgId, property_id: P, unit_id: unit, utility_type: 'electricity', responsibility_mode: 'owner_paid', meter_role: 'submeter' });
      await service.from('meter_telemetry_readings').insert([0, 100].map((v, i) => ({ org_id: orgId, property_id: P, meter_id: meter, read_at: sastInstant(2026, 10 + i, 1).toISOString(), raw_value: v, multiplier: 1, value: v, source: 'device', status: 'valid' })));
      await ins('utility_billing_arrangements', { org_id: orgId, property_id: P, unit_id: unit, utility_type: 'electricity', arrangement: 'metered_recharge', effective_from: '2026-01-01' });
      return { unit, tenant, lease };
    };
    const a = await flat('A1', tenantA.id);
    await flat('B1', tenantB.id);
    await ins('utility_tariffs', { org_id: orgId, property_id: P, utility_type: 'electricity', name: 'FICTIONAL R3', tariff_kind: 'flat', fixed_charge: 0, blocks: [{ upTo: null, rate: 3 }], effective_from: '2026-01-01' });
    await billing.generateCharges(service, { propertyId: P, periodStart: '2026-10-01', periodEnd: '2026-11-01', actorUserId: staff.id });
    const { data: drafts } = await service.from('utility_charges').select('id').eq('property_id', P);
    await billing.approveCharges(service, { chargeIds: drafts!.map((c) => c.id), propertyId: P, actorUserId: staff.id }); // statements are built from approved charges only
    await statements.generateStatements(service, { propertyId: P, periodStart: '2026-10-01', periodEnd: '2026-11-01', audience: 'tenant', actorUserId: staff.id });
    const { data: stA } = await service.from('utility_statements').select('id').eq('lease_id', a.lease).single();
    await statements.statementAction(service, { statementId: stA!.id, propertyId: P, action: 'approve', actorUserId: staff.id });

    // Another tenant cannot dispute A's statement (RLS: invisible -> 404), and nothing changes.
    mockAuthorizationHeader = `Bearer ${await token(tenantB.email)}`;
    expect((await call(stA!.id, { reason: 'This is not my statement but I try anyway' })).status).toBe(404);
    expect((await service.from('utility_charges').select('dispute_status').eq('lease_id', a.lease).single()).data!.dispute_status).toBe('none');

    // Tenant A: too-short reason refused; a real query opens the dispute.
    mockAuthorizationHeader = `Bearer ${await token(tenantA.email)}`;
    expect((await call(stA!.id, { reason: 'wrong' })).status).toBe(400);
    const res = await call(stA!.id, { reason: 'My meter reads 90 kWh, not 100 kWh. Photo available.' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ disputed: 1, alreadyDisputed: 0 });
    const { data: charge } = await service.from('utility_charges').select('id, dispute_status, dispute_reason, total_amount, status').eq('lease_id', a.lease).single();
    expect(charge).toMatchObject({ dispute_status: 'open', total_amount: 300, status: 'approved' });
    expect(charge!.dispute_reason).toMatch(/^Tenant query: My meter reads 90 kWh/);
    // A disputed charge cannot be invoiced until staff resolve it.
    const staffSession = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    await staffSession.auth.signInWithPassword({ email: staff.email, password: 'TestPassw0rd!23' });
    await expect(billing.invoiceCharges(staffSession, service, { chargeIds: [charge!.id], propertyId: P, actorUserId: staff.id })).rejects.toThrow();
    // Staff were notified, and the dispute is audited.
    expect((await service.from('notifications').select('id').eq('user_id', staff.id).eq('type', 'utility_dispute')).data).toHaveLength(1);
    expect((await service.from('audit_events').select('action').eq('entity_id', charge!.id)).data!.map((e) => e.action)).toContain('utility_charge.dispute_opened');
    // Asking again does not duplicate anything.
    expect(await (await call(stA!.id, { reason: 'Following up on my earlier query please.' })).json()).toEqual({ disputed: 0, alreadyDisputed: 1 });
  });
});
