import { NextResponse, type NextRequest } from 'next/server';
import { smartMeterCreateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { canWriteUtilities, forbidden, jsonError, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';
import { loadReadableMeter, meterInsertRow, meterWriteError } from '@/lib/smartUtility/meters';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/smart-meters/:id/replace -- physical meter swap without losing history: the old meter
 * is decommissioned (readings kept) and a new meter is created with replaced_meter_id → old, so
 * consumption is computed per physical meter and summed across the chain (no bogus delta from the
 * old meter's last reading to the new meter's first).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, smartMeterCreateSchema);
  if ('response' in parsed) return parsed.response;
  const old = await loadReadableMeter(auth.supabase, id);
  if (!old) return notFound('Meter');
  if (!(await canWriteUtilities(auth.supabase, old.org_id, old.property_id))) return forbidden();
  if (!old.active) return jsonError(409, 'meter_inactive', 'This meter has already been replaced or decommissioned.');
  if (parsed.data.utilityType !== old.utility_type) {
    return jsonError(400, 'utility_type_mismatch', 'A replacement must measure the same utility.');
  }

  const now = new Date().toISOString();
  // Decommission first so the new meter can take over the same device binding (unique among
  // ACTIVE meters only).
  const { error: decError } = await auth.supabase
    .from('utility_meters')
    .update({ active: false, decommissioned_at: now })
    .eq('id', old.id);
  if (decError) return serverError('smart_meter_replace_failed', 'Could not replace this meter.', 'smart_meters.replace.decommission', decError);

  const { data, error } = await auth.supabase
    .from('utility_meters')
    .insert({ ...meterInsertRow(old.org_id, old.property_id, parsed.data), replaced_meter_id: old.id })
    .select('id')
    .single();
  if (error) {
    // Restore the old meter so a failed replacement never leaves the property without one.
    await auth.supabase.from('utility_meters').update({ active: true, decommissioned_at: null }).eq('id', old.id);
    return meterWriteError(error) ?? serverError('smart_meter_replace_failed', 'Could not replace this meter.', 'smart_meters.replace.insert', error);
  }
  // Submeters that pointed at the old main/check meter now point at its replacement.
  await auth.supabase.from('utility_meters').update({ parent_meter_id: data.id }).eq('parent_meter_id', old.id).eq('active', true);

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: old.org_id,
    actorUserId: auth.user.id,
    actorType: 'user',
    action: 'smart_meter.replace',
    entityType: 'utility_meters',
    entityId: data.id,
    before: { meterId: old.id },
    after: { meterId: data.id },
  });
  return NextResponse.json({ meterId: data.id, replacedMeterId: old.id }, { status: 201 });
}
