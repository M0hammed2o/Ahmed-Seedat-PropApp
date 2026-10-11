import { describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Telemetry retention by downsampling (TD-53, migration 181). Off unless configured; never younger than 400 days;
// keeps each SAST day's first and last reading plus anything a person entered, attached evidence to, or flagged.

vi.mock('server-only', () => ({}));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
delete process.env.SMART_UTILITY_TELEMETRY_RETENTION_DAYS;

const { runTelemetryRetention } = await import('../jobs');
const { sastInstant } = await import('../consumption');

const URL_ = 'http://127.0.0.1:54321';
let reachable = false;
try {
  reachable = (await fetch(`${URL_}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const d = reachable ? describe : describe.skip;
const service: SupabaseClient = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

d('telemetry retention (real local Supabase)', () => {
  it('is off by default and refuses cutoffs younger than 400 days', async () => {
    expect(await runTelemetryRetention(service, new Date())).toEqual({ enabled: false, deleted: 0 });
    const { error } = await service.rpc('downsample_meter_telemetry', { p_cutoff: new Date(Date.now() - 30 * 86_400_000).toISOString(), p_limit: 10 });
    expect(error?.message).toMatch(/never downsampled/);
  }, 30_000);

  it('keeps day boundaries, manual and flagged readings; removes routine readings in between', async () => {
    const sfx = Date.now();
    const orgId = (await service.from('organizations').insert({ legal_name: `RT ${sfx}`, org_type: 'agency' }).select('id').single()).data!.id;
    const propertyId = (await service.from('properties').insert({ org_id: orgId, nickname: 'RT', address_line1: '1', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' }).select('id').single()).data!.id;
    const meterId = (await service.from('utility_meters').insert({ org_id: orgId, property_id: propertyId, utility_type: 'water', responsibility_mode: 'owner_paid', meter_role: 'main' }).select('id').single()).data!.id;
    // Two old SAST days (≈ 2 years ago), readings every 6 hours: 00:00, 06:00, 12:00, 18:00.
    const rows: Record<string, unknown>[] = [];
    let v = 1000;
    for (const day of [3, 4]) {
      for (const hour of [0, 6, 12, 18]) {
        v += 10;
        rows.push({ org_id: orgId, property_id: propertyId, meter_id: meterId, read_at: sastInstant(2024, 9, day, hour).toISOString(), raw_value: v, multiplier: 1, value: v, source: 'device', status: 'valid' });
      }
    }
    // A person-entered reading and a flagged one in the middle of day 3 must survive.
    rows.push({ org_id: orgId, property_id: propertyId, meter_id: meterId, read_at: sastInstant(2024, 9, 3, 9).toISOString(), raw_value: 1015, multiplier: 1, value: 1015, source: 'manual', status: 'valid' });
    rows.push({ org_id: orgId, property_id: propertyId, meter_id: meterId, read_at: sastInstant(2024, 9, 3, 15).toISOString(), raw_value: 5, multiplier: 1, value: 5, source: 'device', status: 'suspect' });
    const { error: insertError } = await service.from('meter_telemetry_readings').insert(rows);
    expect(insertError).toBeNull();

    process.env.SMART_UTILITY_TELEMETRY_RETENTION_DAYS = '30'; // clamped up to 400
    try {
      const r = await runTelemetryRetention(service, new Date());
      expect(r.enabled).toBe(true);
      expect(r.deleted).toBeGreaterThanOrEqual(4);
    } finally {
      delete process.env.SMART_UTILITY_TELEMETRY_RETENTION_DAYS;
    }
    const { data: left } = await service.from('meter_telemetry_readings').select('read_at, source, status').eq('meter_id', meterId).order('read_at');
    const hours = (left ?? []).map((x) => new Date(new Date(x.read_at).getTime() + 2 * 3_600_000).toISOString().slice(8, 13));
    // day 3: 00 (first), 09 manual, 15 suspect, 18 (last); day 4: 00 (first), 18 (last)
    expect(hours).toEqual(['03T00', '03T09', '03T15', '03T18', '04T00', '04T18']);
  }, 60_000);
});
