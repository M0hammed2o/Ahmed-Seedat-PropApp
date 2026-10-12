import { describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Smart-meter readiness: a gateway that was offline reconnects and BACKFILLS buffered readings, out of order, after
// newer readings already arrived. Simulated (no hardware). Expectations: no false reset/suspect status, no alert,
// the meter's "last reading" never moves backwards, consumption across the gap is exact, and a replay is a duplicate.

vi.mock('server-only', () => ({}));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
delete process.env.RESEND_API_KEY;

const { storeReadings } = await import('../ingest');
const { issueToken } = await import('../tokens');
const { consumptionForPeriod } = await import('../consumption');

const URL_ = 'http://127.0.0.1:54321';
let reachable = false;
try {
  reachable = (await fetch(`${URL_}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const d = reachable ? describe : describe.skip;
const service: SupabaseClient = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

d('ingestion: disconnection, reconnection and out-of-order backfill (simulated, real local Supabase)', () => {
  it('backfilled older readings are valid, alert-free, never move "last reading" backwards, and replays are duplicates', async () => {
    const sfx = Date.now();
    const orgId = (await service.from('organizations').insert({ legal_name: `BF ${sfx}`, org_type: 'agency', utilities_enabled: true }).select('id').single()).data!.id as string;
    const propertyId = (await service.from('properties').insert({ org_id: orgId, nickname: 'BF', address_line1: '1', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' }).select('id').single()).data!.id as string;
    const t = issueToken();
    const { data: integration } = await service
      .from('meter_integrations')
      .insert({ org_id: orgId, property_id: propertyId, provider: 'generic_json', name: 'BF gateway', token_prefix: t.prefix, token_hash: t.hash })
      .select('id, org_id, property_id, provider, status')
      .single();
    const meterId = (
      await service
        .from('utility_meters')
        .insert({ org_id: orgId, property_id: propertyId, utility_type: 'water', responsibility_mode: 'owner_paid', meter_role: 'main', connectivity: 'http_push', integration_id: integration!.id, external_device_id: 'BF-1', external_channel: 'total', multiplier: 1 })
        .select('id')
        .single()
    ).data!.id as string;

    const now = new Date();
    const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);
    const r = (minutesAgo: number, value: number, id: string) => ({ externalDeviceId: 'BF-1', channel: 'total', readAt: at(minutesAgo), rawValue: value, eventId: id });

    // Online: readings 120 and 0 minutes ago (the gateway then lost its uplink in between).
    const live = await storeReadings(service, integration as never, [r(120, 1000, 'e-120'), r(0, 1012, 'e-0')], { now });
    expect(live).toMatchObject({ accepted: 2, suspect: 0, duplicates: 0 });
    const lastBefore = (await service.from('utility_meters').select('last_reading_at').eq('id', meterId).single()).data!.last_reading_at as string;

    // Reconnect: the buffered readings from the gap arrive LATE and OUT OF ORDER.
    const backfill = [r(30, 1009, 'e-30'), r(90, 1003, 'e-90'), r(60, 1006, 'e-60')];
    const res = await storeReadings(service, integration as never, backfill, { now });
    expect(res).toMatchObject({ accepted: 3, suspect: 0, duplicates: 0 });
    const { data: rows } = await service.from('meter_telemetry_readings').select('read_at, value, status').eq('meter_id', meterId).order('read_at');
    expect(rows!.map((x) => [Number(x.value), x.status])).toEqual([[1000, 'valid'], [1003, 'valid'], [1006, 'valid'], [1009, 'valid'], [1012, 'valid']]);
    expect((await service.from('utility_alerts').select('id').eq('meter_id', meterId)).data).toEqual([]); // no false reset alert
    const lastAfter = (await service.from('utility_meters').select('last_reading_at').eq('id', meterId).single()).data!.last_reading_at as string;
    expect(new Date(lastAfter).getTime()).toBe(new Date(lastBefore).getTime()); // never moved backwards

    // Consumption across the whole window is exact (12 units), with or without the backfill.
    const points = rows!.map((x) => ({ readAt: new Date(x.read_at), rawValue: Number(x.value), value: Number(x.value), multiplier: 1, status: x.status as 'valid' }));
    expect(consumptionForPeriod(points, at(130), at(-1)).consumption).toBe(12);

    // A redelivery of the same backfill is recognised as duplicates, never double-counted.
    expect(await storeReadings(service, integration as never, backfill, { now })).toMatchObject({ accepted: 0, duplicates: 3 });
  }, 60_000);
});
