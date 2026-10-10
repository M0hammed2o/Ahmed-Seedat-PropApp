import { NextResponse, type NextRequest } from 'next/server';
import { sourceLogSchema, sourceReadingSchema, supplySourceUpdateSchema } from '@propvault/validation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string; sourceId: string }> };

async function loadSource(supabase: SupabaseClient, propertyId: string, sourceId: string) {
  const { data } = await supabase.from('utility_supply_sources').select('id, org_id, property_id, utility_type, source_type, name').eq('id', sourceId).eq('property_id', propertyId).maybeSingle();
  return data;
}

/** GET — recent level readings (30 days) and operating logs (fuel, tanker deliveries, maintenance). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id, sourceId } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const source = await loadSource(auth.supabase, id, sourceId);
  if (!source) return notFound('Supply source');
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: readings }, { data: logs }] = await Promise.all([
    auth.supabase.from('utility_source_readings').select('id, metric, value, read_at, source').eq('source_id', sourceId).gte('read_at', since).order('read_at', { ascending: false }).limit(1000),
    auth.supabase
      .from('utility_source_logs')
      .select('id, log_type, occurred_at, quantity, quantity_unit, cost_amount, cost_vat_inclusive, notes, created_at')
      .eq('source_id', sourceId)
      .order('occurred_at', { ascending: false })
      .limit(200),
  ]);
  return NextResponse.json({ source, readings: readings ?? [], logs: logs ?? [] });
}

/** PATCH — rename, (de)activate, thresholds, capacity. Type and utility never change (add a new source instead). */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id, sourceId } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, supplySourceUpdateSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const d = parsed.data;
  const patch: Record<string, unknown> = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.active !== undefined) patch.active = d.active;
  if (d.lowLevelPct !== undefined) patch.low_level_pct = d.lowLevelPct;
  if (d.highLevelPct !== undefined) patch.high_level_pct = d.highLevelPct;
  if (d.expectedDailyRunHours !== undefined) patch.expected_daily_run_hours = d.expectedDailyRunHours;
  if (d.capacityValue !== undefined) patch.capacity_value = d.capacityValue;
  if (d.notes !== undefined) patch.notes = d.notes || null;
  if (Object.keys(patch).length === 0) return jsonError(400, 'validation_failed', 'Nothing to update.');
  const { data, error } = await auth.supabase.from('utility_supply_sources').update(patch).eq('id', sourceId).eq('property_id', property.id).select('id').maybeSingle();
  if (error) return serverError('source_update_failed', 'Could not update the source.', 'utility_sources.update', error);
  if (!data) return notFound('Supply source');
  return NextResponse.json({ ok: true });
}

const postSchema = z.discriminatedUnion('kind', [sourceReadingSchema.extend({ kind: z.literal('reading') }), sourceLogSchema.extend({ kind: z.literal('log') })]);

/**
 * POST {kind:'reading', metric, readAt, value} — a manual level reading (dip-stick, gauge, inverter screen).
 * POST {kind:'log', logType, ...} — an operating log entry (fuel purchase, tanker delivery, maintenance).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id, sourceId } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, postSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const source = await loadSource(auth.supabase, property.id, sourceId);
  if (!source) return notFound('Supply source');
  const d = parsed.data;
  if (d.kind === 'reading') {
    if (Date.parse(d.readAt) > Date.now() + 5 * 60_000) return jsonError(400, 'validation_failed', 'A reading cannot be in the future.');
    if (d.metric.endsWith('_pct') && d.value > 100) return jsonError(400, 'validation_failed', 'A percentage cannot exceed 100.');
    // Readings are server-written (no client insert policy): write with the service role after the checks above.
    const { data, error } = await getServiceRoleClient()
      .from('utility_source_readings')
      .insert({ org_id: source.org_id, property_id: property.id, source_id: source.id, metric: d.metric, read_at: d.readAt, value: d.value, source: 'manual', recorded_by: auth.user.id })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return jsonError(409, 'duplicate_reading', 'A reading for that metric and time already exists.');
      return serverError('source_reading_failed', 'Could not save the reading.', 'utility_sources.reading', error);
    }
    return NextResponse.json({ readingId: data.id }, { status: 201 });
  }
  if (d.documentId) {
    const { data: doc } = await auth.supabase.from('documents').select('id, org_id').eq('id', d.documentId).maybeSingle();
    if (!doc || doc.org_id !== property.org_id) return jsonError(400, 'invalid_document', 'Document not found.');
  }
  const { data, error } = await auth.supabase
    .from('utility_source_logs')
    .insert({
      org_id: source.org_id,
      property_id: property.id,
      source_id: source.id,
      log_type: d.logType,
      occurred_at: d.occurredAt,
      quantity: d.quantity ?? null,
      quantity_unit: d.quantityUnit ?? null,
      cost_amount: d.costAmount ?? null,
      cost_vat_inclusive: d.costVatInclusive,
      document_id: d.documentId ?? null,
      notes: d.notes || null,
      created_by: auth.user.id,
    })
    .select('id')
    .single();
  if (error) return serverError('source_log_failed', 'Could not save the log entry.', 'utility_sources.log', error);
  return NextResponse.json({ logId: data.id }, { status: 201 });
}
