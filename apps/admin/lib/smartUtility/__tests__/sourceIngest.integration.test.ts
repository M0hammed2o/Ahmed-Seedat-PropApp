import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Level sensors on supply sources (tank level, battery SoC) arrive through the same ingestion path as meters,
// but are stored as instant levels — never as cumulative consumption — and only for sensors bound on the
// pushing integration.

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { storeReadings } = await import('../ingest');

const SUPABASE_URL = 'http://127.0.0.1:54321';
let reachable = false;
try {
  reachable = (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const describeIfSupabase = reachable ? describe : describe.skip;
const service: SupabaseClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

describeIfSupabase('supply-source level ingestion (real local Supabase integration)', () => {
  const suffix = Date.now().toString(36).slice(-8).padStart(8, '0');
  let integration: Parameters<typeof storeReadings>[1];
  let tankId: string;

  beforeAll(async () => {
    const { data: org } = await service.from('organizations').insert({ legal_name: `SRC ${suffix}`, org_type: 'agency' }).select('id').single();
    const { data: prop } = await service
      .from('properties')
      .insert({ org_id: org!.id, nickname: 'SRC', address_line1: '3', city: 'Polokwane', province: 'Limpopo', postal_code: '0700' })
      .select('id')
      .single();
    const { data: integ } = await service
      .from('meter_integrations')
      .insert({ org_id: org!.id, property_id: prop!.id, provider: 'generic_json', name: 'Gateway', token_prefix: `src${suffix}a`, token_hash: 'b'.repeat(64) })
      .select('id, org_id, property_id, provider, status, token_hash, previous_token_hash, previous_token_expires_at')
      .single();
    integration = integ as typeof integration;
    const { data: tank } = await service
      .from('utility_supply_sources')
      .insert({
        org_id: org!.id,
        property_id: prop!.id,
        utility_type: 'water',
        source_type: 'storage_tank',
        name: 'JoJo 10 000 L',
        capacity_value: 10_000,
        capacity_unit: 'litres',
        integration_id: integ!.id,
        external_device_id: 'tank-sensor-1',
        external_channel: 'level',
        level_metric: 'tank_level_pct',
      })
      .select('id')
      .single();
    tankId = tank!.id;
  });

  it('stores bound level readings once, ignores unbound channels, rejects impossible percentages', async () => {
    const now = new Date();
    const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000);
    const readings = [
      { externalDeviceId: 'tank-sensor-1', channel: 'level', readAt: at(60), rawValue: 72.5, eventId: 'e1' },
      { externalDeviceId: 'tank-sensor-1', channel: 'level', readAt: at(30), rawValue: 64, eventId: 'e2' }, // a level may fall: no reset logic
      { externalDeviceId: 'tank-sensor-1', channel: 'battery', readAt: at(30), rawValue: 3.6, eventId: 'e3' }, // unbound channel
      { externalDeviceId: 'tank-sensor-1', channel: 'level', readAt: at(10), rawValue: 140, eventId: 'e4' }, // > 100 %
      { externalDeviceId: 'stranger', channel: 'level', readAt: at(10), rawValue: 50, eventId: 'e5' },
    ];
    const first = await storeReadings(service, integration, readings, { now });
    expect(first.accepted).toBe(2);
    expect(first.ignored).toBe(1);
    expect(first.rejected.map((r) => r.reason).sort()).toEqual(['invalid_value', 'unknown_device']);

    const replay = await storeReadings(service, integration, readings.slice(0, 2), { now });
    expect(replay).toMatchObject({ accepted: 0, duplicates: 2 });

    const { data } = await service.from('utility_source_readings').select('metric, value, source').eq('source_id', tankId).order('read_at');
    expect(data).toEqual([
      { metric: 'tank_level_pct', value: 72.5, source: 'device' },
      { metric: 'tank_level_pct', value: 64, source: 'device' },
    ]);
    // Nothing leaked into cumulative meter telemetry.
    const { count } = await service.from('meter_telemetry_readings').select('id', { count: 'exact', head: true }).eq('integration_id', integration.id);
    expect(count).toBe(0);
  });
});
