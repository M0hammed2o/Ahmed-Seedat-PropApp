import { NextResponse, type NextRequest } from 'next/server';
import { allocationGroupSchema } from '@propvault/validation';
import { z } from 'zod';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

/** GET — shared meter groups with their members and allocation method. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const { data, error } = await auth.supabase
    .from('utility_allocation_groups')
    .select('id, meter_id, name, method, landlord_share_pct, active, created_at, utility_meters(meter_number, utility_type, location), utility_allocation_members(id, unit_id, percentage, occupants, units(unit_label, size_sqm))')
    .eq('property_id', id)
    .order('created_at', { ascending: false });
  if (error) return serverError('groups_failed', 'Could not load shared meter groups.', 'utility_groups.list', error);
  return NextResponse.json({ groups: data ?? [] });
}

/**
 * POST — a shared meter group: one meter split across units by equal share, floor area (units.size_sqm),
 * occupancy or fixed percentages, after carving out the landlord's (common-area) share.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, allocationGroupSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const d = parsed.data;
  const { data: meter } = await auth.supabase.from('utility_meters').select('id, property_id, active, measurement_kind').eq('id', d.meterId).maybeSingle();
  if (!meter || meter.property_id !== property.id || !meter.active) return jsonError(400, 'invalid_meter', 'Meter not found on this property.');
  if (meter.measurement_kind !== 'consumption') {
    return jsonError(400, 'invalid_meter', 'Only a consumption meter can be shared between units (solar, battery, grid, pump and source meters are never billed).');
  }
  const { data: units } = await auth.supabase.from('units').select('id, size_sqm').eq('property_id', property.id).in('id', d.members.map((m) => m.unitId));
  if ((units ?? []).length !== d.members.length) return jsonError(400, 'invalid_unit', 'Every member must be a unit of this property.');
  if (d.method === 'floor_area' && (units ?? []).some((u) => !u.size_sqm || Number(u.size_sqm) <= 0)) {
    return jsonError(400, 'missing_floor_area', 'Floor-area allocation needs a floor area (m²) on every member unit.');
  }
  const { data: group, error } = await auth.supabase
    .from('utility_allocation_groups')
    .insert({ org_id: property.org_id, property_id: property.id, meter_id: d.meterId, name: d.name, method: d.method, landlord_share_pct: d.landlordSharePct })
    .select('id')
    .single();
  if (error) return serverError('group_create_failed', 'Could not save the group.', 'utility_groups.insert', error);
  const { error: memberError } = await auth.supabase.from('utility_allocation_members').insert(
    d.members.map((m) => ({
      group_id: group.id,
      org_id: property.org_id,
      property_id: property.id,
      unit_id: m.unitId,
      percentage: d.method === 'percentage' ? (m.percentage ?? 0) : null,
      occupants: d.method === 'occupancy' ? (m.occupants ?? 0) : null,
    })),
  );
  if (memberError) {
    await auth.supabase.from('utility_allocation_groups').delete().eq('id', group.id);
    return serverError('group_members_failed', 'Could not save the group members.', 'utility_groups.members', memberError);
  }
  return NextResponse.json({ groupId: group.id }, { status: 201 });
}

const patchSchema = z.object({ groupId: z.string().uuid(), active: z.boolean() });

/** PATCH {groupId, active} — retire a group. Membership changes = a new group (charges keep the old snapshot). */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, patchSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const { data, error } = await auth.supabase
    .from('utility_allocation_groups')
    .update({ active: parsed.data.active })
    .eq('id', parsed.data.groupId)
    .eq('property_id', property.id)
    .select('id')
    .maybeSingle();
  if (error) return serverError('group_update_failed', 'Could not update the group.', 'utility_groups.update', error);
  if (!data) return notFound('Group');
  return NextResponse.json({ ok: true });
}
