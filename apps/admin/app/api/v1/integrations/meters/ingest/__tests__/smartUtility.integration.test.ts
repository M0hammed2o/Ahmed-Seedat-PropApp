import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Smart Utility Monitoring, real local Supabase integration (migration 20260101000175):
// tenant isolation, meter ownership, token-authenticated ingestion, duplicate prevention, reset
// handling, rotation/revocation, overview + reconciliation, manual readings, permission
// enforcement, municipal pack generation/approval/email, retry/back-off, and acceptance.

// Each test makes several real HTTP + DB round trips; 5 s is too tight on a loaded dev machine.
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
// Never reach a real email provider from tests.
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_ADDRESS;
delete process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED;

const { POST: ingest } = await import('../route');
const { POST: createIntegration } = await import('../../../../properties/[id]/meter-integrations/route');
const { POST: integrationAction } = await import('../../../../meter-integrations/[id]/route');
const { POST: createMeter } = await import('../../../../properties/[id]/smart-meters/route');
const { POST: manualReading } = await import('../../../../smart-meters/[id]/telemetry/route');
const { POST: replaceMeter } = await import('../../../../smart-meters/[id]/replace/route');
const { GET: overview } = await import('../../../../properties/[id]/smart-utility/route');
const { PUT: putSettings } = await import('../../../../properties/[id]/municipal-submissions/settings/route');
const { POST: addRecipient } = await import('../../../../properties/[id]/municipal-submissions/recipients/route');
const { POST: generate } = await import('../../../../properties/[id]/municipal-submissions/route');
const { POST: submissionAction } = await import('../../../../municipal-submissions/[id]/route');
const { sendDueDeliveries, MAX_DELIVERY_ATTEMPTS } = await import('@/lib/smartUtility/submissions');
const { reconcileProperty, runDailyAnomalies } = await import('@/lib/smartUtility/jobs');
const { sastInstant } = await import('@/lib/smartUtility/consumption');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let supabaseReachable = false;
try {
  supabaseReachable = (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

const service: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const password = 'TestPassw0rd!23';

async function makeUser(email: string) {
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { id: data.user!.id, token: (await res.json()).access_token as string };
}

function as(token: string | null) {
  mockAuthorizationHeader = token ? `Bearer ${token}` : null;
}

function req(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });

function milesightUplink(devEui: string, pulse: number, time: Date, fCnt: number) {
  const bytes = Buffer.from([0x05, 0xc8, pulse & 0xff, (pulse >> 8) & 0xff, (pulse >> 16) & 0xff, (pulse >>> 24) & 0xff]);
  return { devEUI: devEui, fCnt, time: time.toISOString(), data: bytes.toString('base64') };
}

describeIfSupabase('Smart Utility Monitoring (real local Supabase integration)', () => {
  const suffix = Date.now();
  let orgId: string;
  let otherOrgId: string;
  let propertyId: string;
  let otherPropertyId: string;
  let unitA: string;
  let unitB: string;
  let manager: { id: string; token: string };
  let viewer: { id: string; token: string };
  let outsider: { id: string; token: string };
  let token: string;
  let integrationId: string;
  let otherToken: string;
  let mainMeterId: string;
  let subMeterId: string;
  const MAIN_EUI = '24E1241300000AA1';
  const SUB_EUI = '24E1241300000BB2';
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  beforeAll(async () => {
    manager = await makeUser(`su-manager-${suffix}@propertyvault.example`);
    viewer = await makeUser(`su-viewer-${suffix}@propertyvault.example`);
    outsider = await makeUser(`su-outsider-${suffix}@propertyvault.example`);
    const { data: orgs } = await service
      .from('organizations')
      .insert([
        { legal_name: `SU Org ${suffix}`, org_type: 'agency' },
        { legal_name: `SU Other ${suffix}`, org_type: 'agency' },
      ])
      .select('id');
    orgId = orgs![0]!.id;
    otherOrgId = orgs![1]!.id;
    await service.from('organization_members').insert([
      { org_id: orgId, user_id: manager.id, role: 'manager', status: 'active', joined_at: now.toISOString() },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', status: 'active', joined_at: now.toISOString() },
      { org_id: otherOrgId, user_id: outsider.id, role: 'manager', status: 'active', joined_at: now.toISOString() },
    ]);
    const { data: props } = await service
      .from('properties')
      .insert([
        { org_id: orgId, nickname: 'SU Block', address_line1: '1 Meter St', city: 'Pretoria', province: 'Gauteng', postal_code: '0001', municipal_account_number: '5001234567' },
        { org_id: otherOrgId, nickname: 'Other Block', address_line1: '2 Meter St', city: 'Pretoria', province: 'Gauteng', postal_code: '0001' },
      ])
      .select('id');
    propertyId = props![0]!.id;
    otherPropertyId = props![1]!.id;
    const { data: units } = await service
      .from('units')
      .insert([
        { org_id: orgId, property_id: propertyId, unit_label: 'Unit A', status: 'occupied' },
        { org_id: orgId, property_id: propertyId, unit_label: 'Unit B', status: 'vacant' },
      ])
      .select('id');
    unitA = units![0]!.id;
    unitB = units![1]!.id;
  }, 30_000);

  it('PERMISSION: a viewer cannot connect hardware; a manager gets a one-time token', async () => {
    as(viewer.token);
    expect((await createIntegration(req(`/x`, 'POST', { provider: 'milesight_lorawan', name: 'GW' }), p(propertyId))).status).toBe(403);
    as(manager.token);
    const res = await createIntegration(req(`/x`, 'POST', { provider: 'milesight_lorawan', name: 'Block gateway' }), p(propertyId));
    expect(res.status).toBe(201);
    const body = await res.json();
    token = body.token;
    integrationId = body.integration.id;
    expect(token).toMatch(/^pmi_[a-z0-9]{12}_/);
    expect(body.ingestUrl).toContain('/api/v1/integrations/meters/ingest');
    // Plaintext never stored.
    const { data } = await service.from('meter_integrations').select('token_hash').eq('id', integrationId).single();
    expect(data!.token_hash).not.toContain(token);
    expect(data!.token_hash).toHaveLength(64);

    as(outsider.token);
    const other = await createIntegration(req(`/x`, 'POST', { provider: 'milesight_lorawan', name: 'Other GW' }), p(otherPropertyId));
    otherToken = (await other.json()).token;
  });

  it('TENANT ISOLATION: an outsider cannot see or add meters to this property', async () => {
    as(outsider.token);
    expect((await overview(req('/x', 'GET'), p(propertyId))).status).toBe(404);
    const res = await createMeter(
      req('/x', 'POST', { utilityType: 'water', meterRole: 'main', ownership: 'municipal', connectivity: 'manual' }),
      p(propertyId),
    );
    expect(res.status).toBe(404);
  });

  it('METER OWNERSHIP: creates a municipal main meter and a unit submeter bound to the gateway', async () => {
    as(manager.token);
    const main = await createMeter(
      req('/x', 'POST', {
        utilityType: 'water', meterRole: 'main', ownership: 'municipal', meterNumber: 'TSH-W-1', serialNumber: 'SN-MAIN',
        connectivity: 'lorawan', integrationId, externalDeviceId: MAIN_EUI, multiplier: 0.5, valueOffset: 1_000_000,
        registerDigits: 8, expectedIntervalMinutes: 60, tariffPerUnit: 40,
      }),
      p(propertyId),
    );
    expect(main.status).toBe(201);
    mainMeterId = (await main.json()).meterId;
    const sub = await createMeter(
      req('/x', 'POST', {
        utilityType: 'water', meterRole: 'submeter', ownership: 'private', unitId: unitA, parentMeterId: mainMeterId,
        connectivity: 'lorawan', integrationId, externalDeviceId: SUB_EUI, multiplier: 0.5, expectedIntervalMinutes: 60,
      }),
      p(propertyId),
    );
    expect(sub.status).toBe(201);
    subMeterId = (await sub.json()).meterId;

    // A unit from another org is refused by the DB trigger.
    const { data: foreignUnit } = await service
      .from('units')
      .insert({ org_id: otherOrgId, property_id: otherPropertyId, unit_label: 'X' })
      .select('id')
      .single();
    const bad = await createMeter(
      req('/x', 'POST', { utilityType: 'water', meterRole: 'submeter', ownership: 'private', unitId: foreignUnit!.id, connectivity: 'manual' }),
      p(propertyId),
    );
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);

    // The same device cannot be bound twice.
    const dup = await createMeter(
      req('/x', 'POST', { utilityType: 'water', meterRole: 'submeter', ownership: 'private', unitId: unitB, connectivity: 'lorawan', integrationId, externalDeviceId: SUB_EUI }),
      p(propertyId),
    );
    expect(dup.status).toBe(409);
  });

  it('INGESTION: rejects missing/invalid tokens', async () => {
    expect((await ingest(req('/x', 'POST', milesightUplink(MAIN_EUI, 1, now, 1)))).status).toBe(401);
    expect((await ingest(req('/x', 'POST', milesightUplink(MAIN_EUI, 1, now, 1), { authorization: 'Bearer pmi_aaaaaaaaaaaa_' + 'x'.repeat(43) }))).status).toBe(401);
  });

  it('INGESTION + DUPLICATES: accepts readings once, counts replays as duplicates', async () => {
    const auth = { authorization: `Bearer ${token}` };
    // 30 hourly readings: main 10 L/h more than the submeter (common area / leak), 20 pulses/h → 10 L/h at 0.5 L/pulse
    for (let h = 30; h >= 0; h--) {
      const t = hoursAgo(h);
      const k = 30 - h;
      const res = await ingest(req('/x', 'POST', [milesightUplink(MAIN_EUI, 1000 + k * 60, t, k), milesightUplink(SUB_EUI, 500 + k * 40, t, k)], auth));
      expect(res.status).toBe(200);
    }
    const replay = await ingest(req('/x', 'POST', milesightUplink(MAIN_EUI, 1000 + 30 * 60, hoursAgo(0), 30), auth));
    const body = await replay.json();
    expect(body).toMatchObject({ accepted: 0, duplicates: 1 });
    const { count } = await service.from('meter_telemetry_readings').select('id', { count: 'exact', head: true }).eq('meter_id', mainMeterId);
    expect(count).toBe(31);
    // value = raw × multiplier + offset (dial alignment)
    const { data: latest } = await service.from('utility_meters').select('last_reading_value, health_status').eq('id', mainMeterId).single();
    expect(Number(latest!.last_reading_value)).toBe(1_000_000 + (1000 + 30 * 60) * 0.5);
    expect(latest!.health_status).toBe('online');
    }, 60_000); // 31 sequential gateway requests, one per simulated hour

  it('SPOOFING: unknown devices, another org’s token and future timestamps are rejected', async () => {
    const res = await ingest(req('/x', 'POST', milesightUplink('24E1241399999999', 5, now, 1), { authorization: `Bearer ${token}` }));
    expect((await res.json()).rejected[0].reason).toBe('unknown_device');
    // Another org's valid token naming THIS org's device cannot write to it.
    const cross = await ingest(req('/x', 'POST', milesightUplink(MAIN_EUI, 999999, now, 99), { authorization: `Bearer ${otherToken}` }));
    expect((await cross.json()).rejected[0].reason).toBe('unknown_device');
    const future = await ingest(req('/x', 'POST', milesightUplink(MAIN_EUI, 5000, new Date(now.getTime() + 3_600_000), 200), { authorization: `Bearer ${token}` }));
    expect((await future.json()).rejected[0].reason).toBe('future_timestamp');
    const malformed = await ingest(req('/x', 'POST', { hello: 'world' }, { authorization: `Bearer ${token}` }));
    expect(malformed.status).toBe(422);
  });

  it('RESET HANDLING: a register drop is stored as suspect and raises one alert', async () => {
    const auth = { authorization: `Bearer ${token}` };
    // A third device on unit B, then a reset.
    as(manager.token);
    const m = await createMeter(
      req('/x', 'POST', { utilityType: 'water', meterRole: 'submeter', ownership: 'private', unitId: unitB, parentMeterId: mainMeterId, connectivity: 'lorawan', integrationId, externalDeviceId: '24E1241300000CC3', multiplier: 0.5 }),
      p(propertyId),
    );
    const meterId = (await m.json()).meterId;
    await ingest(req('/x', 'POST', milesightUplink('24E1241300000CC3', 9000, hoursAgo(3), 1), auth));
    const res = await ingest(req('/x', 'POST', milesightUplink('24E1241300000CC3', 12, hoursAgo(2), 2), auth));
    expect((await res.json()).suspect).toBe(1);
    const { data: alerts } = await service.from('utility_alerts').select('rule').eq('meter_id', meterId);
    expect(alerts!.map((a) => a.rule)).toEqual(['meter_reset_detected']);
    // Decommission it so it doesn't affect reconciliation below.
    await service.from('utility_meters').update({ active: false, decommissioned_at: now.toISOString() }).eq('id', meterId);
  });

  it('OVERVIEW + RECONCILIATION: shows unallocated main-meter consumption without classifying it', async () => {
    as(manager.token);
    const res = await overview(req('/x', 'GET'), p(propertyId));
    expect(res.status).toBe(200);
    const body = await res.json();
    const water = body.totals.find((t: { utilityType: string }) => t.utilityType === 'water');
    expect(water.basis).toBe('main_meter');
    expect(body.meters).toHaveLength(3);
    expect(body.submission.autoSubmissionEnabled).toBe(false);
    // Viewer can read the dashboard too.
    as(viewer.token);
    expect((await overview(req('/x', 'GET'), p(propertyId))).status).toBe(200);
  });

  it('MANUAL READINGS: viewer forbidden; manager records a dial reading with a 409 on duplicate time', async () => {
    const t = hoursAgo(0.5).toISOString();
    as(viewer.token);
    expect((await manualReading(req('/x', 'POST', { readAt: t, reading: 1001 }), p(mainMeterId))).status).toBe(403);
    as(manager.token);
    expect((await manualReading(req('/x', 'POST', { readAt: t, reading: 1001.5 }), p(mainMeterId))).status).toBe(201);
    expect((await manualReading(req('/x', 'POST', { readAt: t, reading: 1001.5 }), p(mainMeterId))).status).toBe(409);
    as(outsider.token);
    expect((await manualReading(req('/x', 'POST', { readAt: hoursAgo(0.4).toISOString(), reading: 1 }), p(mainMeterId))).status).toBe(404);
  });

  it('ROTATION + REVOCATION: the old token works during grace; a revoked integration is refused', async () => {
    as(manager.token);
    const rot = await integrationAction(req('/x', 'POST', { action: 'rotate' }), p(integrationId));
    const newToken = (await rot.json()).token as string;
    expect(newToken).not.toBe(token);
    const oldStill = await ingest(req('/x', 'POST', milesightUplink(SUB_EUI, 500 + 31 * 40, hoursAgo(0.2), 31), { authorization: `Bearer ${token}` }));
    expect(oldStill.status).toBe(200);
    const fresh = await ingest(req('/x', 'POST', milesightUplink(SUB_EUI, 500 + 32 * 40, hoursAgo(0.1), 32), { authorization: `Bearer ${newToken}` }));
    expect(fresh.status).toBe(200);
    as(viewer.token);
    expect((await integrationAction(req('/x', 'POST', { action: 'revoke' }), p(integrationId))).status).toBe(403);
    as(manager.token);
    expect((await integrationAction(req('/x', 'POST', { action: 'revoke' }), p(integrationId))).status).toBe(200);
    expect((await ingest(req('/x', 'POST', milesightUplink(SUB_EUI, 99999, now, 33), { authorization: `Bearer ${newToken}` }))).status).toBe(403);
    expect((await ingest(req('/x', 'POST', milesightUplink(SUB_EUI, 99999, now, 34), { authorization: `Bearer ${token}` }))).status).toBe(401);
  });

  it('REPLACEMENT: swapping a meter keeps the old readings and re-parents nothing incorrectly', async () => {
    as(manager.token);
    const res = await replaceMeter(
      req('/x', 'POST', { utilityType: 'water', meterRole: 'submeter', ownership: 'private', unitId: unitA, parentMeterId: mainMeterId, connectivity: 'manual', meterNumber: 'NEW-A' }),
      p(subMeterId),
    );
    expect(res.status).toBe(201);
    const { data: old } = await service.from('utility_meters').select('active, decommissioned_at').eq('id', subMeterId).single();
    expect(old!.active).toBe(false);
    const { count } = await service.from('meter_telemetry_readings').select('id', { count: 'exact', head: true }).eq('meter_id', subMeterId);
    expect(count).toBeGreaterThan(30);
  });

  it('RECONCILIATION (job): main 30 L/h vs submeter 20 L/h → one-third unallocated, flagged above threshold', async () => {
    // Uses the replaced submeter's history through the replacement chain.
    const [r] = await reconcileProperty(service, propertyId, { start: hoursAgo(29), end: hoursAgo(1) }, 15);
    expect(r!.main.id).toBe(mainMeterId);
    expect(r!.result.main).toBe(840);
    expect(r!.result.submeterTotal).toBe(560);
    expect(r!.result.unallocated).toBe(280);
    expect(r!.result.unallocatedPct).toBe(33.33);
    expect(r!.result.status).toBe('above_threshold');
  });

  it('ANOMALIES (job): night flow + vacant-unit use are raised once, with staff notified', async () => {
    const { data: meter } = await service
      .from('utility_meters')
      .insert({ org_id: orgId, property_id: propertyId, unit_id: unitB, utility_type: 'water', meter_role: 'submeter', ownership: 'private', responsibility_mode: 'owner_paid', connectivity: 'simulator', expected_interval_minutes: 60, tariff_per_unit: 40, meter_number: 'NIGHT-1' })
      .select('id')
      .single();
    const rows = Array.from({ length: 26 }, (_, h) => {
      const at = sastInstant(2026, 9, 1, h);
      return { org_id: orgId, property_id: propertyId, meter_id: meter!.id, read_at: at.toISOString(), raw_value: h * 12, multiplier: 1, value: h * 12, source: 'simulator' };
    });
    await service.from('meter_telemetry_readings').insert(rows);
    const jobNow = sastInstant(2026, 9, 2, 3);
    const first = await runDailyAnomalies(service, jobNow);
    expect(first.alertsCreated).toBeGreaterThanOrEqual(2);
    const { data: alerts } = await service.from('utility_alerts').select('rule, estimated_cost, title').eq('meter_id', meter!.id).order('rule');
    expect(alerts!.map((a) => a.rule)).toEqual(['vacant_unit_consumption', 'water_continuous_night_flow']);
    // 12 L/h overnight → 288 L/day plausible loss → 0.288 kL × R40 = R11.52
    expect(Number(alerts!.find((a) => a.rule === 'water_continuous_night_flow')!.estimated_cost)).toBe(11.52);
    expect(alerts!.every((a) => !/theft/i.test(a.title))).toBe(true);
    const second = await runDailyAnomalies(service, jobNow);
    const { count } = await service.from('utility_alerts').select('id', { count: 'exact', head: true }).eq('meter_id', meter!.id);
    expect(count).toBe(2);
    expect(second.alertsCreated).toBe(0);
    const { data: notes } = await service.from('notifications').select('type').eq('user_id', manager.id).eq('type', 'utility_alert');
    expect(notes!.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  describe('municipal submissions', () => {
    let submissionId: string;

    it('rejects automatic mode for an app-only municipality; saves approval-required settings', async () => {
      as(manager.token);
      const bad = await putSettings(
        req('/x', 'PUT', { municipalityCode: 'ekurhuleni', mode: 'automatic', billingDay: 25, leadDays: 5, includePhotos: false, enabled: true }),
        p(propertyId),
      );
      expect(bad.status).toBe(400);
      const ok = await putSettings(
        req('/x', 'PUT', { municipalityCode: 'tshwane', municipalAccountNumber: '5001234567', mode: 'approval_required', billingDay: 25, leadDays: 5, includePhotos: false, enabled: true }),
        p(propertyId),
      );
      expect(ok.status).toBe(200);
    });

    it('PERMISSION: viewer cannot add recipients; manager adds an authorised and an unauthorised one', async () => {
      as(viewer.token);
      expect((await addRecipient(req('/x', 'POST', { email: 'v@example.com', recipientType: 'custom', authorise: true }), p(propertyId))).status).toBe(403);
      as(manager.token);
      expect((await addRecipient(req('/x', 'POST', { email: `agent-${suffix}@example.com`, recipientType: 'managing_agent', authorise: true }), p(propertyId))).status).toBe(201);
      expect((await addRecipient(req('/x', 'POST', { email: `unauth-${suffix}@example.com`, recipientType: 'custom', authorise: false }), p(propertyId))).status).toBe(201);
    });

    it('generates an approval-required pack (idempotent per period) containing only the municipal meter', async () => {
      as(manager.token);
      const res = await generate(req('/x', 'POST', {}), p(propertyId));
      expect(res.status).toBe(201);
      const body = await res.json();
      submissionId = body.submissionId;
      expect(body.status).toBe('pending_approval');
      const again = await generate(req('/x', 'POST', {}), p(propertyId));
      expect((await again.json()).submissionId).toBe(submissionId);
      const { data } = await service.from('municipal_submissions').select('report').eq('id', submissionId).single();
      const report = data!.report as { meters: { meterId: string }[]; municipalAccountNumber: string };
      expect(report.meters.map((m) => m.meterId)).toEqual([mainMeterId]);
      expect(report.municipalAccountNumber).toBe('5001234567');
    });

    it('outsider cannot approve; manager approval emails ONLY the authorised recipient (mock provider)', async () => {
      as(outsider.token);
      expect((await submissionAction(req('/x', 'POST', { action: 'approve' }), p(submissionId))).status).toBe(404);
      as(manager.token);
      const res = await submissionAction(req('/x', 'POST', { action: 'approve' }), p(submissionId));
      expect(res.status).toBe(200);
      const { data: deliveries } = await service.from('municipal_submission_deliveries').select('recipient_email, status, last_error, email_message_id').eq('submission_id', submissionId);
      expect(deliveries).toHaveLength(1);
      expect(deliveries![0]!.recipient_email).toBe(`agent-${suffix}@example.com`);
      expect(deliveries![0]!.status).toBe('sent');
      expect(deliveries![0]!.last_error).toMatch(/not configured \(mock\)/);
      const { data: msg } = await service.from('email_messages').select('template_name, status').eq('id', deliveries![0]!.email_message_id!).single();
      expect(msg).toMatchObject({ template_name: 'municipal_meter_reading_report', status: 'queued' });
      const { data: sub } = await service.from('municipal_submissions').select('status, acceptance_status').eq('id', submissionId).single();
      // Sent is not accepted.
      expect(sub).toMatchObject({ status: 'sent', acceptance_status: 'unknown' });
    });

    it('records municipal acceptance only when a person says so', async () => {
      as(manager.token);
      const res = await submissionAction(req('/x', 'POST', { action: 'acceptance', acceptanceStatus: 'accepted', reference: 'REF-1' }), p(submissionId));
      expect(res.status).toBe(200);
      const { data } = await service.from('municipal_submissions').select('acceptance_status, submission_reference').eq('id', submissionId).single();
      expect(data).toMatchObject({ acceptance_status: 'accepted', submission_reference: 'REF-1' });
    });

    it('approval with no authorised recipient is refused (409) and leaves the pack unchanged', async () => {
      const { data: prop } = await service
        .from('properties')
        .insert({ org_id: orgId, nickname: 'SU No Recipients', address_line1: '3 Meter St', city: 'Pretoria', province: 'Gauteng', postal_code: '0001' })
        .select('id')
        .single();
      as(manager.token);
      const gen = await generate(req('/x', 'POST', {}), p(prop!.id));
      const { submissionId: sid, status } = await gen.json();
      expect(status).toBe('draft'); // no settings row ⇒ manual mode
      const res = await submissionAction(req('/x', 'POST', { action: 'approve' }), p(sid));
      expect(res.status).toBe(409);
      const { data } = await service.from('municipal_submissions').select('status, approved_at').eq('id', sid).single();
      expect(data).toMatchObject({ status: 'draft', approved_at: null });
    });

    it('RETRY: failed sends back off 1 h / 6 h / 24 h, then stop and notify staff', async () => {
      // A fresh pack for an older period, approved, with a failing sender.
      const { data: sub } = await service
        .from('municipal_submissions')
        .insert({ org_id: orgId, property_id: propertyId, period_start: '2026-01-25', period_end: '2026-02-25', status: 'approved', mode: 'approval_required', report: { version: 1, generatedAt: now.toISOString(), property: { name: 'SU', address: 'x' }, preparedFor: null, municipality: null, municipalAccountNumber: null, period: { start: '2026-01-25', end: '2026-02-24' }, meters: [], notes: [] } })
        .select('id')
        .single();
      await service.from('municipal_submission_deliveries').insert({ org_id: orgId, property_id: propertyId, submission_id: sub!.id, recipient_email: `retry-${suffix}@example.com`, recipient_type: 'custom', next_attempt_at: now.toISOString() });
      const failing = vi.fn(async () => {
        throw new Error('SMTP 451 temporary');
      });
      let t = new Date(now);
      const expectedGaps = [60, 360, 1440];
      for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
        const r = await sendDueDeliveries(service, { submissionId: sub!.id, now: t, sender: failing as never });
        expect(r.attempted).toBe(1);
        const { data: d } = await service.from('municipal_submission_deliveries').select('attempts, status, next_attempt_at').eq('submission_id', sub!.id).single();
        expect(d!.attempts).toBe(attempt);
        expect(d!.status).toBe('failed');
        if (attempt < MAX_DELIVERY_ATTEMPTS) {
          expect(new Date(d!.next_attempt_at!).getTime() - t.getTime()).toBe(expectedGaps[attempt - 1]! * 60_000);
          // Not due before the back-off elapses.
          expect((await sendDueDeliveries(service, { submissionId: sub!.id, now: new Date(t.getTime() + 60_000), sender: failing as never })).attempted).toBe(0);
          t = new Date(d!.next_attempt_at!);
        } else {
          expect(d!.next_attempt_at).toBeNull();
        }
      }
      expect((await sendDueDeliveries(service, { submissionId: sub!.id, now: new Date(t.getTime() + 7 * 86_400_000), sender: failing as never })).attempted).toBe(0);
      const { data: s } = await service.from('municipal_submissions').select('status').eq('id', sub!.id).single();
      expect(s!.status).toBe('failed');
      const { data: notes } = await service.from('notifications').select('type').eq('user_id', manager.id).eq('related_entity_id', sub!.id);
      expect(notes!.map((n) => n.type)).toContain('municipal_submission_failed');
    });
  });
});
