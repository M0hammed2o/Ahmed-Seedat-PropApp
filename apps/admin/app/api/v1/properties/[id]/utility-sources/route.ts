import { NextResponse, type NextRequest } from 'next/server';
import { supplySourceCreateSchema } from '@propvault/validation';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

const SOURCE_COLUMNS =
  'id, utility_type, source_type, name, building_id, unit_id, capacity_value, capacity_unit, fuel_type, billing_grade, integration_id, external_device_id, external_channel, level_metric, low_level_pct, high_level_pct, expected_daily_run_hours, active, commissioned_on, notes, created_at';

/** GET — supply sources (grid, solar, battery, generator, municipal water, borehole, tanks, tanker) with latest levels. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const { data, error } = await auth.supabase.from('utility_supply_sources').select(SOURCE_COLUMNS).eq('property_id', id).order('utility_type').order('name');
  if (error) return serverError('sources_failed', 'Could not load supply sources.', 'utility_sources.list', error);
  const ids = (data ?? []).map((s) => s.id);
  const latest = new Map<string, { metric: string; value: number; readAt: string }[]>();
  if (ids.length) {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: readings } = await auth.supabase
      .from('utility_source_readings')
      .select('source_id, metric, value, read_at')
      .in('source_id', ids)
      .gte('read_at', since)
      .order('read_at', { ascending: false })
      .limit(2000);
    for (const r of readings ?? []) {
      const list = latest.get(r.source_id) ?? [];
      if (!list.some((x) => x.metric === r.metric)) list.push({ metric: r.metric, value: Number(r.value), readAt: r.read_at });
      latest.set(r.source_id, list);
    }
  }
  return NextResponse.json({ sources: (data ?? []).map((s) => ({ ...s, latest: latest.get(s.id) ?? [] })) });
}

/** POST — add a supply source. Optional level sensor binding must reference this org's integration. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, supplySourceCreateSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const d = parsed.data;
  if (d.integrationId) {
    const { data: integration } = await auth.supabase.from('meter_integrations').select('id, org_id').eq('id', d.integrationId).maybeSingle();
    if (!integration || integration.org_id !== property.org_id) return jsonError(400, 'invalid_integration', 'Integration not found in this organisation.');
    if (!d.externalDeviceId || !d.levelMetric) {
      return jsonError(400, 'validation_failed', 'A sensor binding needs the device ID and the level metric it reports.');
    }
  }
  const { data, error } = await auth.supabase
    .from('utility_supply_sources')
    .insert({
      org_id: property.org_id,
      property_id: property.id,
      building_id: d.buildingId ?? null,
      unit_id: d.unitId ?? null,
      utility_type: d.utilityType,
      source_type: d.sourceType,
      name: d.name,
      capacity_value: d.capacityValue ?? null,
      capacity_unit: d.capacityUnit ?? null,
      fuel_type: d.fuelType ?? null,
      billing_grade: d.billingGrade,
      integration_id: d.integrationId ?? null,
      external_device_id: d.externalDeviceId || null,
      external_channel: d.externalChannel ?? '',
      level_metric: d.levelMetric ?? null,
      low_level_pct: d.lowLevelPct,
      high_level_pct: d.highLevelPct,
      expected_daily_run_hours: d.expectedDailyRunHours ?? null,
      commissioned_on: d.commissionedOn ?? null,
      notes: d.notes || null,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return jsonError(409, 'sensor_in_use', 'That sensor is already bound to another active source.');
    if (/does not belong/.test(error.message)) return jsonError(400, 'invalid_scope', error.message);
    return serverError('source_create_failed', 'Could not save the supply source.', 'utility_sources.insert', error);
  }
  return NextResponse.json({ sourceId: data.id }, { status: 201 });
}
