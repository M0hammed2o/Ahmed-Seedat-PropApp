import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MeterReadingPoint } from './consumption';

// Shared loaders. Work with either a session client (RLS-scoped, for user-facing routes) or the
// service-role client (jobs).

export interface SmartMeterRow {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  building_id: string | null;
  utility_type: 'water' | 'electricity';
  meter_number: string | null;
  meter_role: 'main' | 'submeter' | 'check';
  ownership: 'municipal' | 'private' | null;
  parent_meter_id: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  connectivity: string;
  integration_id: string | null;
  external_device_id: string | null;
  external_channel: string;
  multiplier: number;
  value_offset: number;
  register_digits: number | null;
  expected_interval_minutes: number | null;
  tariff_per_unit: number | null;
  municipal_account_number: string | null;
  last_reading_at: string | null;
  last_reading_value: number | null;
  last_sync_at: string | null;
  health_status: string;
  replaced_meter_id: string | null;
  decommissioned_at: string | null;
  active: boolean;
  installed_date: string | null;
  location: string | null;
  notes: string | null;
  responsibility_mode: string;
  is_prepaid: boolean;
  created_at: string;
}

export const SMART_METER_COLUMNS =
  'id, org_id, property_id, unit_id, building_id, utility_type, meter_number, meter_role, ownership, parent_meter_id, manufacturer, model, serial_number, connectivity, integration_id, external_device_id, external_channel, multiplier, value_offset, register_digits, expected_interval_minutes, tariff_per_unit, municipal_account_number, last_reading_at, last_reading_value, last_sync_at, health_status, replaced_meter_id, decommissioned_at, active, installed_date, location, notes, responsibility_mode, is_prepaid, created_at';

/** Telemetry points per meter in [from, to], paged so a long window never truncates silently. */
export async function loadPoints(
  client: SupabaseClient,
  meterIds: string[],
  from: Date,
  to: Date,
): Promise<Map<string, MeterReadingPoint[]>> {
  const out = new Map<string, MeterReadingPoint[]>();
  for (const id of meterIds) out.set(id, []);
  if (meterIds.length === 0) return out;
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from('meter_telemetry_readings')
      .select('meter_id, read_at, raw_value, value, multiplier, status')
      .in('meter_id', meterIds)
      .gte('read_at', from.toISOString())
      .lte('read_at', to.toISOString())
      .order('read_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`telemetry load failed: ${error.message}`);
    for (const r of data ?? []) {
      out.get(r.meter_id)?.push({
        readAt: r.read_at,
        rawValue: Number(r.raw_value),
        value: Number(r.value),
        multiplier: Number(r.multiplier),
        status: r.status,
      });
    }
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** Replacement chain oldest → newest ending at `meter`, using the supplied meter set. */
export function replacementChain(meter: SmartMeterRow, all: SmartMeterRow[]): SmartMeterRow[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const chain: SmartMeterRow[] = [meter];
  let cursor = meter;
  const seen = new Set([meter.id]);
  while (cursor.replaced_meter_id && byId.has(cursor.replaced_meter_id) && !seen.has(cursor.replaced_meter_id)) {
    cursor = byId.get(cursor.replaced_meter_id)!;
    seen.add(cursor.id);
    chain.unshift(cursor);
  }
  return chain;
}
