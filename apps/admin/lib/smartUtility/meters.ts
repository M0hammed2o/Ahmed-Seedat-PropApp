import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SmartMeterCreateInput } from '@propvault/validation';
import { jsonError } from './http';

export function meterInsertRow(orgId: string, propertyId: string, d: SmartMeterCreateInput) {
  return {
    org_id: orgId,
    property_id: propertyId,
    unit_id: d.unitId ?? null,
    building_id: d.buildingId ?? null,
    utility_type: d.utilityType,
    meter_role: d.meterRole,
    ownership: d.ownership,
    parent_meter_id: d.parentMeterId ?? null,
    meter_number: d.meterNumber || null,
    location: d.location || null,
    manufacturer: d.manufacturer || null,
    model: d.model || null,
    serial_number: d.serialNumber || null,
    connectivity: d.connectivity,
    integration_id: d.connectivity === 'manual' ? null : (d.integrationId ?? null),
    external_device_id: d.connectivity === 'manual' ? null : (d.externalDeviceId?.trim() || null),
    external_channel: d.connectivity === 'manual' ? '' : (d.externalChannel ?? ''),
    multiplier: d.multiplier,
    value_offset: d.valueOffset,
    register_digits: d.registerDigits ?? null,
    expected_interval_minutes: d.expectedIntervalMinutes ?? null,
    tariff_per_unit: d.tariffPerUnit ?? null,
    municipal_account_number: d.municipalAccountNumber || null,
    responsibility_mode: d.responsibilityMode,
    is_prepaid: d.isPrepaid,
    installed_date: d.installedDate ?? null,
    notes: d.notes || null,
  };
}

/** Maps the database triggers' integrity errors to 400s the UI can show. */
export function meterWriteError(error: { code?: string; message: string }) {
  if (error.code === '23505') {
    return jsonError(409, 'device_already_bound', 'That device and channel already feed another active meter.');
  }
  for (const known of [
    'Building does not belong to this property',
    'Parent meter must be a main/check meter of the same property and utility type',
    'Integration does not belong to this property',
    'Replaced meter must be on the same property with the same utility type',
    'A meter cannot be its own parent',
  ]) {
    if (error.message.includes(known)) return jsonError(400, 'invalid_meter_link', known + '.');
  }
  if (error.message.includes('unit_id does not belong to property_id')) {
    return jsonError(400, 'invalid_meter_link', 'The unit does not belong to this property.');
  }
  return null;
}


export interface MeterAccessRow {
  id: string;
  org_id: string;
  property_id: string;
  utility_type: 'water' | 'electricity';
  multiplier: number;
  value_offset: number;
  active: boolean;
}

/** Loads a meter through the caller's RLS-scoped client (null when invisible to them). */
export async function loadReadableMeter(
  supabase: SupabaseClient,
  meterId: string,
): Promise<MeterAccessRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(meterId)) return null;
  const { data } = await supabase
    .from('utility_meters')
    .select('id, org_id, property_id, utility_type, multiplier, value_offset, active')
    .eq('id', meterId)
    .maybeSingle();
  return (data as MeterAccessRow | null) ?? null;
}
