import { NextResponse, type NextRequest } from 'next/server';
import { utilityReadingCreateSchema } from '@propvault/validation';
import type { UtilityHistoryPoint } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { safeErrorMessage } from '@/lib/safeError';
import { isUnusualUsage as computeIsUnusualUsage, percentChange as computePercentChange } from '@/lib/utilityAnomaly';

type RouteParams = { params: Promise<{ id: string }> };

interface UtilityReadingRow {
  period_month: string;
  reading_value: string;
  consumption: string | null;
}

/**
 * GET/POST /api/v1/utility-meters/:id/readings -- UTILITIES_RATES_BUDGET_GAP_AUDIT.md §1E/§1F,
 * migration 20260101000163. GET returns consumption history with server-computed period-over-
 * period % change and an "unusual usage" flag (never "leak detected" -- §4B). POST is a thin
 * wrapper over record_utility_reading(), the one write entry point.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const { data: meter, error: meterError } = await supabase
    .from('utility_meters')
    .select('utility_type')
    .eq('id', id)
    .maybeSingle();
  if (meterError || !meter) {
    return NextResponse.json(
      { error: { code: 'meter_not_found', message: 'Meter not found.' } },
      { status: 404 },
    );
  }
  const unitOfMeasure: 'L' | 'kWh' = meter.utility_type === 'water' ? 'L' : 'kWh';

  const { data, error } = await supabase
    .from('utility_readings')
    .select('period_month, reading_value, consumption')
    .eq('meter_id', id)
    .order('period_month', { ascending: true });
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'utility_readings_list_failed',
          message: safeErrorMessage(error, 'Could not load reading history.', 'utility_readings.list'),
        },
      },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as UtilityReadingRow[];
  const history: UtilityHistoryPoint[] = rows.map((row, index) => {
    const consumption = row.consumption === null ? null : Number(row.consumption);
    const previous = index > 0 ? rows[index - 1] : null;
    const previousConsumption = previous?.consumption === null || previous?.consumption === undefined
      ? null
      : Number(previous.consumption);

    const percentChange = computePercentChange(consumption, previousConsumption);
    const isUnusualUsage = computeIsUnusualUsage({
      consumption,
      previousConsumption,
      unitOfMeasure,
      periodIndex: index,
    });

    return {
      periodMonth: row.period_month,
      readingValue: Number(row.reading_value),
      consumption,
      previousConsumption,
      percentChange,
      isUnusualUsage,
    };
  });

  return NextResponse.json({ history });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = utilityReadingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const { data: meter, error: meterError } = await supabase
    .from('utility_meters')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (meterError || !meter) {
    return NextResponse.json(
      { error: { code: 'meter_not_found', message: 'Meter not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, meter.org_id, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to record readings for this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase.rpc('record_utility_reading', {
    p_meter_id: id,
    p_period_month: parsed.data.periodMonth,
    p_reading_date: parsed.data.readingDate,
    p_reading_value: parsed.data.readingValue,
    p_unit_of_measure: parsed.data.unitOfMeasure,
    p_source: parsed.data.source,
    p_document_id: parsed.data.documentId ?? null,
    p_notes: parsed.data.notes ?? null,
    p_replace_existing: parsed.data.replaceExisting,
  });

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'utility_reading_record_failed',
          message: safeErrorMessage(
            error,
            'Could not record this reading. Please try again, or contact support if this continues.',
            'utility_readings.record',
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ utilityReadingId: data }, { status: 201 });
}
