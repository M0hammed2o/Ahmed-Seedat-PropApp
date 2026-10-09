import { NextResponse, type NextRequest } from 'next/server';
import { manualMeterReadingSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { canWriteUtilities, forbidden, jsonError, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';
import { loadReadableMeter } from '@/lib/smartUtility/meters';

type RouteParams = { params: Promise<{ id: string }> };

/** GET /api/v1/smart-meters/:id/telemetry?from=&to= -- reading history (RLS-scoped), newest first. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const meter = await loadReadableMeter(auth.supabase, id);
  if (!meter) return notFound('Meter');
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');
  let query = auth.supabase
    .from('meter_telemetry_readings')
    .select('id, read_at, raw_value, value, source, status, status_reason, document_id, notes, ingested_at')
    .eq('meter_id', id)
    .order('read_at', { ascending: false })
    .limit(500);
  if (from && !Number.isNaN(Date.parse(from))) query = query.gte('read_at', new Date(from).toISOString());
  if (to && !Number.isNaN(Date.parse(to))) query = query.lte('read_at', new Date(to).toISOString());
  const { data, error } = await query;
  if (error) return serverError('telemetry_list_failed', 'Could not load readings.', 'telemetry.list', error);
  const factor = meter.utility_type === 'water' ? 1 / 1000 : 1;
  return NextResponse.json({
    displayUnit: meter.utility_type === 'water' ? 'kL' : 'kWh',
    readings: (data ?? []).map((r) => ({
      id: r.id,
      readAt: r.read_at,
      reading: Math.round(Number(r.value) * factor * 1000) / 1000,
      source: r.source,
      status: r.status,
      statusReason: r.status_reason,
      documentId: r.document_id,
      notes: r.notes,
    })),
  });
}

/**
 * POST /api/v1/smart-meters/:id/telemetry -- a manual reading (kL / kWh, as on the dial), with an
 * optional photo (documentId from POST /api/v1/documents). Works for meters without smart hardware
 * and as a dial check on connected meters. Written with the service-role client (telemetry has no
 * client write policy) only after can_write_property_utilities passes for the caller.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, manualMeterReadingSchema);
  if ('response' in parsed) return parsed.response;
  const meter = await loadReadableMeter(auth.supabase, id);
  if (!meter) return notFound('Meter');
  if (!(await canWriteUtilities(auth.supabase, meter.org_id, meter.property_id))) return forbidden();
  if (!meter.active) return jsonError(409, 'meter_inactive', 'This meter has been decommissioned.');

  const readAt = new Date(parsed.data.readAt);
  if (readAt.getTime() > Date.now() + 5 * 60_000) {
    return jsonError(400, 'future_timestamp', 'The reading time cannot be in the future.');
  }

  const service = getServiceRoleClient();
  if (parsed.data.documentId) {
    // The photo must be a live document of the same property (no cross-property evidence).
    const { data: doc } = await auth.supabase
      .from('documents')
      .select('id, property_id')
      .eq('id', parsed.data.documentId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!doc || doc.property_id !== meter.property_id) {
      return jsonError(400, 'invalid_document', 'The photo must be uploaded to this property first.');
    }
  }

  // Display unit → base unit (L for water), then back to the meter's raw register scale so manual
  // and device readings form one consistent series.
  const base = meter.utility_type === 'water' ? parsed.data.reading * 1000 : parsed.data.reading;
  const multiplier = Number(meter.multiplier);
  const offset = Number(meter.value_offset ?? 0);
  if (base < offset) {
    return jsonError(400, 'below_offset', 'The reading is lower than the meter’s configured starting reading.');
  }
  const raw = Math.round(((base - offset) / multiplier) * 10_000) / 10_000;

  const { data, error } = await service
    .from('meter_telemetry_readings')
    .insert({
      org_id: meter.org_id,
      property_id: meter.property_id,
      meter_id: meter.id,
      read_at: readAt.toISOString(),
      raw_value: raw,
      multiplier,
      value: Math.round(base * 10_000) / 10_000,
      source: 'manual',
      status: 'valid',
      document_id: parsed.data.documentId ?? null,
      recorded_by: auth.user.id,
      notes: parsed.data.notes || null,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return jsonError(409, 'duplicate_reading', 'A reading already exists for this meter at that time.');
    return serverError('manual_reading_failed', 'Could not save the reading.', 'telemetry.manual', error);
  }

  const { data: current } = await service.from('utility_meters').select('last_reading_at').eq('id', meter.id).single();
  if (!current?.last_reading_at || new Date(current.last_reading_at) < readAt) {
    await service
      .from('utility_meters')
      .update({ last_reading_at: readAt.toISOString(), last_reading_value: base })
      .eq('id', meter.id);
  }
  await writeAuditEvent(service, {
    orgId: meter.org_id,
    actorUserId: auth.user.id,
    actorType: 'user',
    action: 'meter_reading.manual',
    entityType: 'meter_telemetry_readings',
    entityId: data.id,
    after: { meterId: meter.id, readAt: readAt.toISOString(), reading: parsed.data.reading, hasPhoto: !!parsed.data.documentId },
  });
  return NextResponse.json({ readingId: data.id }, { status: 201 });
}
