import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Meter evidence workflow against a real local Supabase (migration 176).
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

const { POST: review } = await import('../route');
const { GET: evidence } = await import('../evidence/route');
const { POST: manualReading } = await import('../../../smart-meters/[id]/telemetry/route');
const { consumptionForPeriod } = await import('@/lib/smartUtility/consumption');

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
const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = (id: string) => ({ params: Promise.resolve({ id }) });

describeIfSupabase('Meter evidence (real local Supabase integration)', () => {
  const suffix = Date.now();
  let manager: { id: string; token: string };
  let viewer: { id: string; token: string };
  let meterId: string;
  const ids: string[] = [];

  beforeAll(async () => {
    manager = await makeUser(`su4-m-${suffix}@propertyvault.example`);
    viewer = await makeUser(`su4-v-${suffix}@propertyvault.example`);
    const { data: org } = await service.from('organizations').insert({ legal_name: `SU4 ${suffix}`, org_type: 'agency' }).select('id').single();
    await service.from('organization_members').insert([
      { org_id: org!.id, user_id: manager.id, role: 'manager', status: 'active', joined_at: new Date().toISOString() },
      { org_id: org!.id, user_id: viewer.id, role: 'viewer', status: 'active', joined_at: new Date().toISOString() },
    ]);
    const { data: prop } = await service.from('properties').insert({ org_id: org!.id, nickname: 'SU4', address_line1: '1', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' }).select('id').single();
    const { data: meter } = await service
      .from('utility_meters')
      .insert({ org_id: org!.id, property_id: prop!.id, utility_type: 'water', responsibility_mode: 'owner_paid', meter_role: 'main', ownership: 'municipal', meter_number: 'E-1', location: 'Boundary box' })
      .select('id')
      .single();
    meterId = meter!.id;
    as(manager.token);
    for (const [h, kl] of [[72, 100], [48, 101], [24, 999], [1, 103]] as const) {
      const res = await manualReading(req('POST', { readAt: new Date(Date.now() - h * 3_600_000).toISOString(), reading: kl }), p(meterId));
      ids.push((await res.json()).readingId);
    }
  });

  it('person-entered readings start unverified', async () => {
    const { data } = await service.from('meter_telemetry_readings').select('verification_status').in('id', ids);
    expect(data!.every((r) => r.verification_status === 'unverified')).toBe(true);
  });

  it('a viewer cannot review; a manager can verify, and rejecting removes the bad reading from consumption', async () => {
    as(viewer.token);
    expect((await review(req('POST', { decision: 'verified' }), p(ids[0]!))).status).toBe(403);
    as(manager.token);
    expect((await review(req('POST', { decision: 'verified' }), p(ids[0]!))).status).toBe(200);
    // 999 kL is a typo: with it, the series has a reset (999 → 103); after rejection it's 100 → 101 → 103.
    expect((await review(req('POST', { decision: 'rejected', note: 'typo, should be 102' }), p(ids[2]!))).status).toBe(200);
    const { data: rows } = await service
      .from('meter_telemetry_readings')
      .select('read_at, raw_value, value, multiplier, status')
      .eq('meter_id', meterId)
      .order('read_at');
    const pts = rows!.map((r) => ({ readAt: r.read_at, rawValue: Number(r.raw_value), value: Number(r.value), multiplier: Number(r.multiplier), status: r.status }));
    const c = consumptionForPeriod(pts, new Date(Date.now() - 80 * 3_600_000), new Date());
    expect(c.consumption).toBe(3000); // litres: 100 kL → 103 kL
    expect(c.resetInPeriod).toBe(false);
    const { data: audit } = await service.from('audit_events').select('action').eq('entity_id', ids[2]!);
    expect(audit!.map((a) => a.action)).toContain('meter_reading.rejected');
  });

  it('device readings are not reviewable', async () => {
    const { data: dev } = await service
      .from('meter_telemetry_readings')
      .insert({ org_id: (await service.from('utility_meters').select('org_id').eq('id', meterId).single()).data!.org_id, property_id: (await service.from('utility_meters').select('property_id').eq('id', meterId).single()).data!.property_id, meter_id: meterId, read_at: new Date(Date.now() - 30 * 60_000).toISOString(), raw_value: 103100, multiplier: 1, value: 103100, source: 'device' })
      .select('id')
      .single();
    expect((await review(req('POST', { decision: 'verified' }), p(dev!.id))).status).toBe(409);
  });

  it('renders the evidence PDF for readers, including viewers', async () => {
    as(viewer.token);
    const res = await evidence(req('GET'), p(ids[0]!));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    as(manager.token);
  });
});
