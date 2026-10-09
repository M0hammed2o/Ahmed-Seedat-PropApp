import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Universal integration engine against a real local Supabase (migration 176): encrypted credentials
// (never selectable, never returned), SSRF guard, poll sync with idempotency, failure back-off,
// alerting after repeated failures, reconnection, and ChirpStack push via the real ingest route.

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

let mockAuthorizationHeader: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null),
  }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, getAll: () => [] }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
delete process.env.RESEND_API_KEY;
delete process.env.SMART_UTILITY_CREDENTIALS_KEY;

const { POST: createIntegration } = await import('../../../properties/[id]/meter-integrations/route');
const { POST: integrationAction } = await import('../route');
const { POST: createMeter } = await import('../../../properties/[id]/smart-meters/route');
const { POST: ingest } = await import('../../../integrations/meters/ingest/route');
const { syncIntegration, loadPollIntegration, FAILURES_BEFORE_ALERT } = await import('@/lib/smartUtility/sync');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
let reachable = false;
try {
  reachable = (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const describeIfSupabase = reachable ? describe : describe.skip;

const service: SupabaseClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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
const req = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = (id: string) => ({ params: Promise.resolve({ id }) });

const TB_DEVICE = '0e3c1b30-5a5b-11ef-8a50-1b2c3d4e5f60';

describeIfSupabase('Smart Utilities engine (real local Supabase integration)', () => {
  const suffix = Date.now();
  let propertyId: string;
  let manager: { id: string; token: string };
  let tbId: string;
  let meterId: string;

  beforeAll(async () => {
    manager = await makeUser(`su2-manager-${suffix}@propertyvault.example`);
    const { data: org } = await service.from('organizations').insert({ legal_name: `SU2 ${suffix}`, org_type: 'agency' }).select('id').single();
    await service.from('organization_members').insert({ org_id: org!.id, user_id: manager.id, role: 'manager', status: 'active', joined_at: new Date().toISOString() });
    const { data: prop } = await service
      .from('properties')
      .insert({ org_id: org!.id, nickname: 'SU2 Block', address_line1: '1 St', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' })
      .select('id')
      .single();
    propertyId = prop!.id;
    mockAuthorizationHeader = `Bearer ${manager.token}`;
  });

  it('FAILS CLOSED: a polled connection cannot be created without the encryption key', async () => {
    const res = await createIntegration(
      req('/x', 'POST', { provider: 'thingsboard', name: 'TB', config: { baseUrl: 'https://tb.example.com' }, credentials: { apiKey: 'k-secret-123' } }),
      p(propertyId),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('credentials_key_missing');
  });

  it('SSRF: rejects http and private addresses', async () => {
    process.env.SMART_UTILITY_CREDENTIALS_KEY = Buffer.alloc(32, 9).toString('base64');
    for (const baseUrl of ['http://tb.example.com', 'https://169.254.169.254', 'https://10.1.2.3']) {
      const res = await createIntegration(req('/x', 'POST', { provider: 'thingsboard', name: 'TB', config: { baseUrl }, credentials: { apiKey: 'k' } }), p(propertyId));
      expect(res.status).toBe(400);
    }
  });

  it('stores credentials encrypted, returns no token, and hides the ciphertext from API clients', async () => {
    const res = await createIntegration(
      req('/x', 'POST', { provider: 'thingsboard', name: 'TB', config: { baseUrl: 'https://tb.example.com' }, credentials: { apiKey: 'k-secret-123' }, syncIntervalMinutes: 60 }),
      p(propertyId),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    tbId = body.integration.id;
    expect(body.token).toBeNull();
    expect(JSON.stringify(body)).not.toContain('k-secret-123');
    const { data } = await service.from('meter_integrations').select('credentials_ciphertext, sync_mode').eq('id', tbId).single();
    expect(data!.sync_mode).toBe('poll');
    expect(data!.credentials_ciphertext).toMatch(/^v1:/);
    expect(data!.credentials_ciphertext).not.toContain('k-secret-123');
    const session = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${manager.token}` } }, auth: { persistSession: false } });
    const { error } = await session.from('meter_integrations').select('credentials_ciphertext').eq('id', tbId);
    expect(error?.code).toBe('42501');
  });

  it('POLL SYNC: stores readings once, is idempotent on re-sync', async () => {
    const m = await createMeter(
      req('/x', 'POST', { utilityType: 'electricity', meterRole: 'main', ownership: 'private', connectivity: 'http_push', integrationId: tbId, externalDeviceId: TB_DEVICE, externalChannel: 'energy', expectedIntervalMinutes: 60 }),
      p(propertyId),
    );
    expect(m.status).toBe(201);
    meterId = (await m.json()).meterId;
    const now = new Date();
    const pts = [3, 2, 1].map((h, i) => ({ ts: now.getTime() - h * 3_600_000, value: String(100 + i * 5) }));
    const fetchImpl = vi.fn(async () => Response.json({ energy: pts })) as unknown as typeof fetch;
    const row = (await loadPollIntegration(service, tbId))!;
    const first = await syncIntegration(service, row, { now, fetchImpl });
    expect(first.ok).toBe(true);
    expect(first.result).toMatchObject({ accepted: 3, duplicates: 0 });
    const again = await syncIntegration(service, (await loadPollIntegration(service, tbId))!, { now, fetchImpl });
    expect(again.result).toMatchObject({ accepted: 0, duplicates: 3 });
    const { count } = await service.from('meter_telemetry_readings').select('id', { count: 'exact', head: true }).eq('meter_id', meterId);
    expect(count).toBe(3);
    const { data: integ } = await service.from('meter_integrations').select('last_sync_status, consecutive_failures, next_sync_at').eq('id', tbId).single();
    expect(integ).toMatchObject({ last_sync_status: 'ok', consecutive_failures: 0 });
    expect(new Date(integ!.next_sync_at!).getTime() - now.getTime()).toBe(60 * 60_000);
  });

  it('FAILURES: back off, flag meters and notify staff after repeated failures; recover on reconnection', async () => {
    const failing = vi.fn(async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    let now = new Date();
    for (let i = 1; i <= FAILURES_BEFORE_ALERT; i++) {
      const out = await syncIntegration(service, (await loadPollIntegration(service, tbId))!, { now, fetchImpl: failing });
      expect(out.ok).toBe(false);
      const { data } = await service.from('meter_integrations').select('consecutive_failures, next_sync_at, last_sync_error').eq('id', tbId).single();
      expect(data!.consecutive_failures).toBe(i);
      expect(new Date(data!.next_sync_at!).getTime() - now.getTime()).toBe(Math.min(60 * 2 ** i, 1440) * 60_000);
      expect(data!.last_sync_error).toMatch(/HTTP 503/);
      now = new Date(now.getTime() + 60_000);
    }
    const { data: meter } = await service.from('utility_meters').select('health_status').eq('id', meterId).single();
    expect(meter!.health_status).toBe('error');
    const { data: notes } = await service.from('notifications').select('type').eq('user_id', manager.id).eq('type', 'meter_integration_failing');
    expect(notes).toHaveLength(1);

    const ok = vi.fn(async () => Response.json({ energy: [{ ts: now.getTime() - 60_000, value: '130' }] })) as unknown as typeof fetch;
    const back = await syncIntegration(service, (await loadPollIntegration(service, tbId))!, { now, fetchImpl: ok });
    expect(back.ok).toBe(true);
    const { data: after } = await service.from('meter_integrations').select('consecutive_failures, last_sync_status').eq('id', tbId).single();
    expect(after).toMatchObject({ consecutive_failures: 0, last_sync_status: 'ok' });
    const { data: m2 } = await service.from('utility_meters').select('health_status').eq('id', meterId).single();
    expect(m2!.health_status).toBe('online');
  });

  it('push providers refuse polled actions; poll providers refuse pushed payloads', async () => {
    const cs = await createIntegration(req('/x', 'POST', { provider: 'chirpstack_v4', name: 'CS' }), p(propertyId));
    const csBody = await cs.json();
    expect((await integrationAction(req('/x', 'POST', { action: 'sync_now' }), p(csBody.integration.id))).status).toBe(409);

    // ChirpStack push through the real ingest route: the bound "pulse" channel is stored, the
    // codec's battery field on the same device is ignored (not rejected as an unknown device).
    await createMeter(
      req('/x', 'POST', { utilityType: 'water', meterRole: 'check', ownership: 'private', connectivity: 'lorawan', integrationId: csBody.integration.id, externalDeviceId: '24E1241300000CC3', externalChannel: 'pulse', multiplier: 0.5 }),
      p(propertyId),
    );
    const up = { deduplicationId: crypto.randomUUID(), time: new Date().toISOString(), deviceInfo: { devEui: '24e1241300000cc3' }, fCnt: 1, object: { pulse: 2000, battery: 90 } };
    const res = await ingest(req('/x?event=up', 'POST', up, { authorization: `Bearer ${csBody.token}` }));
    expect(await res.json()).toMatchObject({ accepted: 1, ignored: 1, rejected: [] });
    const join = await ingest(req('/x?event=join', 'POST', { deviceInfo: { devEui: '24e1241300000cc3' } }, { authorization: `Bearer ${csBody.token}` }));
    expect(await join.json()).toMatchObject({ accepted: 0, rejected: [] });
  });

  it('revoking a polled connection destroys its stored credentials', async () => {
    expect((await integrationAction(req('/x', 'POST', { action: 'revoke' }), p(tbId))).status).toBe(200);
    const { data } = await service.from('meter_integrations').select('credentials_ciphertext, status').eq('id', tbId).single();
    expect(data).toMatchObject({ credentials_ciphertext: null, status: 'revoked' });
  });
});
