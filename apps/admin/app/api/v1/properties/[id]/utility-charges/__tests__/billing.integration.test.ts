import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Utility billing against a real local Supabase (migration 176 + create_manual_invoice from 152):
// tariff history, draft charges from actual consumption, idempotent generation, approval rules,
// DRAFT invoices only (never issued), unit allocation to the right lease/tenant, permissions.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

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

const { POST: charges } = await import('../route');
const { POST: addTariff } = await import('../../utility-tariffs/route');
const { sastInstant } = await import('@/lib/smartUtility/consumption');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
let reachable = false;
try {
  reachable = (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const describeIfSupabase = reachable ? describe : describe.skip;
const service: SupabaseClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

async function makeUser(email: string) {
  const { data, error } = await service.auth.admin.createUser({ email, password: 'TestPassw0rd!23', email_confirm: true });
  if (error) throw error;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassw0rd!23' }),
  });
  return { id: data.user!.id, token: (await res.json()).access_token as string };
}
const as = (t: string) => (mockAuthorizationHeader = `Bearer ${t}`);
const req = (body: unknown) => new NextRequest('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const p = (id: string) => ({ params: Promise.resolve({ id }) });

const PERIOD = { periodStart: '2026-08-25', periodEnd: '2026-09-25' };

describeIfSupabase('Utility billing (real local Supabase integration)', () => {
  const suffix = Date.now();
  let manager: { id: string; token: string };
  let viewer: { id: string; token: string };
  let propertyId: string;
  let orgId: string;
  let tenantId: string;
  let leaseId: string;
  let chargeA: string;
  let chargeB: string;

  beforeAll(async () => {
    manager = await makeUser(`su5-m-${suffix}@propertyvault.example`);
    viewer = await makeUser(`su5-v-${suffix}@propertyvault.example`);
    const { data: org } = await service.from('organizations').insert({ legal_name: `SU5 ${suffix}`, org_type: 'agency' }).select('id').single();
    orgId = org!.id;
    await service.from('organization_members').insert([
      { org_id: orgId, user_id: manager.id, role: 'manager', status: 'active', joined_at: new Date().toISOString() },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', status: 'active', joined_at: new Date().toISOString() },
    ]);
    const { data: prop } = await service.from('properties').insert({ org_id: orgId, nickname: 'SU5 Flats', address_line1: '5 Bill St', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' }).select('id').single();
    propertyId = prop!.id;
    const { data: units } = await service
      .from('units')
      .insert([
        { org_id: orgId, property_id: propertyId, unit_label: 'Flat 1', status: 'occupied' },
        { org_id: orgId, property_id: propertyId, unit_label: 'Flat 2', status: 'vacant' },
      ])
      .select('id, unit_label');
    const flat1 = units!.find((u) => u.unit_label === 'Flat 1')!.id;
    const flat2 = units!.find((u) => u.unit_label === 'Flat 2')!.id;
    const { data: tenant } = await service.from('tenants').insert({ org_id: orgId, full_name: 'T Tenant', status: 'active' }).select('id').single();
    tenantId = tenant!.id;
    const { data: lease } = await service.from('leases').insert({ org_id: orgId, unit_id: flat1, start_date: '2026-01-01', rent_amount: 8000, status: 'active' }).select('id').single();
    leaseId = lease!.id;
    await service.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });

    const mk = async (unitId: string, label: string) =>
      (await service.from('utility_meters').insert({ org_id: orgId, property_id: propertyId, unit_id: unitId, utility_type: 'water', responsibility_mode: 'owner_paid', meter_role: 'submeter', ownership: 'private', meter_number: label }).select('id').single()).data!.id;
    const m1 = await mk(flat1, 'F1-W');
    const m2 = await mk(flat2, 'F2-W');
    const s = sastInstant(2026, 8, 25).getTime();
    const e = sastInstant(2026, 9, 25).getTime();
    // Flat 1: 12,000 L (12 kL) across the period; Flat 2: one reading only (insufficient).
    await service.from('meter_telemetry_readings').insert([
      { org_id: orgId, property_id: propertyId, meter_id: m1, read_at: new Date(s).toISOString(), raw_value: 50_000, multiplier: 1, value: 50_000, source: 'device' },
      { org_id: orgId, property_id: propertyId, meter_id: m1, read_at: new Date(e).toISOString(), raw_value: 62_000, multiplier: 1, value: 62_000, source: 'device' },
      { org_id: orgId, property_id: propertyId, meter_id: m2, read_at: new Date(s + 86_400_000).toISOString(), raw_value: 10, multiplier: 1, value: 10, source: 'device' },
    ]);
  });

  it('PERMISSION: a viewer can neither add tariffs nor generate charges', async () => {
    as(viewer.token);
    expect((await addTariff(req({ utilityType: 'water', name: 'X', blocks: [{ upTo: null, rate: 1 }], effectiveFrom: '2026-07-01' }), p(propertyId))).status).toBe(403);
    expect((await charges(req(PERIOD), p(propertyId))).status).toBe(403);
  });

  it('keeps tariff history: a new tariff closes the previous one the day before', async () => {
    as(manager.token);
    expect((await addTariff(req({ utilityType: 'water', name: '2025/26', fixedCharge: 50, blocks: [{ upTo: null, rate: 30 }], effectiveFrom: '2025-07-01' }), p(propertyId))).status).toBe(201);
    expect((await addTariff(req({ utilityType: 'water', name: '2026/27', fixedCharge: 85, blocks: [{ upTo: 6, rate: 20 }, { upTo: 10.5, rate: 30 }, { upTo: null, rate: 50 }], effectiveFrom: '2026-07-01' }), p(propertyId))).status).toBe(201);
    const bad = await addTariff(req({ utilityType: 'water', name: 'bad', blocks: [{ upTo: 5, rate: 1 }], effectiveFrom: '2026-08-01' }), p(propertyId));
    expect(bad.status).toBe(400);
    const { data } = await service.from('utility_tariffs').select('name, effective_to').eq('property_id', propertyId).order('effective_from');
    expect(data).toEqual([
      { name: '2025/26', effective_to: '2026-06-30' },
      { name: '2026/27', effective_to: null },
    ]);
  });

  it('generates DRAFT charges from actual consumption with the effective tariff, idempotently', async () => {
    const res = await charges(req(PERIOD), p(propertyId));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ created: 2, existing: 0 });
    const again = await (await charges(req(PERIOD), p(propertyId))).json();
    expect(again).toMatchObject({ created: 0, existing: 2 });
    const { data } = await service.from('utility_charges').select('id, consumption, consumption_quality, usage_amount, fixed_amount, total_amount, status, lease_id, tenant_id, units(unit_label)').eq('property_id', propertyId);
    const f1 = data!.find((c) => (c.units as unknown as { unit_label: string }).unit_label === 'Flat 1')!;
    const f2 = data!.find((c) => (c.units as unknown as { unit_label: string }).unit_label === 'Flat 2')!;
    chargeA = f1.id;
    chargeB = f2.id;
    // 12 kL: 6×20 + 4.5×30 + 1.5×50 = 330, + R85 fixed = R415
    expect(Number(f1.consumption)).toBe(12);
    expect(Number(f1.usage_amount)).toBe(330);
    expect(Number(f1.total_amount)).toBe(415);
    expect(f1).toMatchObject({ status: 'draft', lease_id: leaseId, tenant_id: tenantId, consumption_quality: 'complete' });
    expect(f2.consumption).toBeNull();
    expect(f2.lease_id).toBeNull();
  });

  it('refuses to approve a charge whose consumption could not be calculated', async () => {
    const res = await charges(req({ action: 'approve', chargeIds: [chargeB] }), p(propertyId));
    expect(res.status).toBe(409);
  });

  it('approves, then creates a DRAFT invoice (not issued) with usage and fixed lines for the right tenant', async () => {
    expect((await charges(req({ action: 'approve', chargeIds: [chargeA, chargeB] }), p(propertyId))).status).toBe(200);
    const res = await charges(req({ action: 'invoice', chargeIds: [chargeA] }), p(propertyId));
    expect(res.status).toBe(200);
    const { invoices } = await res.json();
    expect(invoices).toHaveLength(1);
    const { data: inv } = await service.from('invoices').select('status, amount, lease_id, tenant_id, issued_at, invoice_line_items(description, amount)').eq('id', invoices[0]).single();
    expect(inv).toMatchObject({ status: 'draft', lease_id: leaseId, tenant_id: tenantId, issued_at: null });
    expect(Number(inv!.amount)).toBe(415);
    const lines = (inv!.invoice_line_items as { description: string; amount: number }[]).map((l) => [l.description.split(' (')[0], Number(l.amount)]);
    expect(lines).toEqual([
      ['Water usage 12 kL', 330],
      ['Water fixed charge', 85],
    ]);
    const { data: c } = await service.from('utility_charges').select('status, invoice_id').eq('id', chargeA).single();
    expect(c).toMatchObject({ status: 'invoiced', invoice_id: invoices[0] });
    // Nothing was posted to the ledger: a draft invoice has no journal entry.
    const { count } = await service.from('journal_entries').select('id', { count: 'exact', head: true }).eq('org_id', orgId);
    expect(count ?? 0).toBe(0);
  });

  it('cannot invoice twice, and void + regenerate works for a corrected period', async () => {
    expect((await charges(req({ action: 'invoice', chargeIds: [chargeA] }), p(propertyId))).status).toBe(409);
    // A draft that could not be calculated is voided, then regenerated for the corrected period.
    expect(await (await charges(req({ action: 'void', chargeIds: [chargeB] }), p(propertyId))).json()).toMatchObject({ voided: 1 });
    // An invoiced charge can never be voided here (it is on an invoice).
    expect(await (await charges(req({ action: 'void', chargeIds: [chargeA] }), p(propertyId))).json()).toMatchObject({ voided: 0 });
    expect(await (await charges(req(PERIOD), p(propertyId))).json()).toMatchObject({ created: 1, existing: 1 });
  });
});
