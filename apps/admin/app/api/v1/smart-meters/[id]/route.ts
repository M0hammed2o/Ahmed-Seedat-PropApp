import { NextResponse, type NextRequest } from 'next/server';
import { smartMeterUpdateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { canWriteUtilities, forbidden, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';
import { loadReadableMeter, meterWriteError } from '@/lib/smartUtility/meters';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/smart-meters/:id -- edit meter configuration, or decommission it. Decommissioning
 * keeps every historical reading (active=false, decommissioned_at); nothing is deleted.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, smartMeterUpdateSchema);
  if ('response' in parsed) return parsed.response;
  const meter = await loadReadableMeter(auth.supabase, id);
  if (!meter) return notFound('Meter');
  if (!(await canWriteUtilities(auth.supabase, meter.org_id, meter.property_id))) return forbidden();

  const d = parsed.data;
  const update: Record<string, unknown> = {};
  const map: [keyof typeof d, string][] = [
    ['meterNumber', 'meter_number'],
    ['location', 'location'],
    ['installedDate', 'installed_date'],
    ['serialNumber', 'serial_number'],
    ['manufacturer', 'manufacturer'],
    ['model', 'model'],
    ['ownership', 'ownership'],
    ['parentMeterId', 'parent_meter_id'],
    ['buildingId', 'building_id'],
    ['multiplier', 'multiplier'],
    ['valueOffset', 'value_offset'],
    ['registerDigits', 'register_digits'],
    ['expectedIntervalMinutes', 'expected_interval_minutes'],
    ['tariffPerUnit', 'tariff_per_unit'],
    ['municipalAccountNumber', 'municipal_account_number'],
    ['notes', 'notes'],
    ['measurementKind', 'measurement_kind'],
    ['supplySourceId', 'supply_source_id'],
  ];
  for (const [key, column] of map) {
    if (d[key] !== undefined) update[column] = d[key] === '' ? null : d[key];
  }
  if (d.decommission) {
    update.active = false;
    update.decommissioned_at = new Date().toISOString();
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ meterId: id, changed: false });

  const { error } = await auth.supabase.from('utility_meters').update(update).eq('id', id);
  if (error) {
    return meterWriteError(error) ?? serverError('smart_meter_update_failed', 'Could not update this meter.', 'smart_meters.update', error);
  }
  await writeAuditEvent(getServiceRoleClient(), {
    orgId: meter.org_id,
    actorUserId: auth.user.id,
    actorType: 'user',
    action: d.decommission ? 'smart_meter.decommission' : 'smart_meter.update',
    entityType: 'utility_meters',
    entityId: id,
    after: update,
  });
  return NextResponse.json({ meterId: id, changed: true });
}
