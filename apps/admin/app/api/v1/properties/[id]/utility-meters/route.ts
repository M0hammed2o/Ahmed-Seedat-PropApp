import { NextResponse, type NextRequest } from 'next/server';
import { utilityMeterCreateSchema } from '@propvault/validation';
import type { UtilityMeter } from '@propvault/types';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

interface UtilityMeterRow {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  utility_type: 'water' | 'electricity';
  meter_number: string | null;
  responsibility_mode: UtilityMeter['responsibilityMode'];
  is_prepaid: boolean;
  active: boolean;
  installed_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: UtilityMeterRow): UtilityMeter {
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    unitId: row.unit_id,
    utilityType: row.utility_type,
    meterNumber: row.meter_number,
    responsibilityMode: row.responsibility_mode,
    isPrepaid: row.is_prepaid,
    active: row.active,
    installedDate: row.installed_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET/POST /api/v1/properties/:id/utility-meters -- UTILITIES_RATES_BUDGET_GAP_AUDIT.md §1D,
 * migration 20260101000163. A meter is optional (§1C: only OWNER_PAID/COMMON_AREA_OWNER typically
 * need one) -- this only creates the meter record; readings are recorded separately via
 * /api/v1/utility-meters/:id/readings.
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

  const unitId = request.nextUrl.searchParams.get('unitId');
  let query = supabase
    .from('utility_meters')
    .select('*')
    .eq('property_id', id)
    .order('utility_type', { ascending: true });
  if (unitId) query = query.eq('unit_id', unitId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'utility_meters_list_failed',
          message: safeErrorMessage(error, 'Could not load utility meters.', 'utility_meters.list'),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ utilityMeters: (data ?? []).map(mapRow) });
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

  const parsed = utilityMeterCreateSchema.safeParse({ ...(body as object), propertyId: id });
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

  const canWrite = await requireOrgRole(supabase, parsed.data.orgId, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to add meters for this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('utility_meters')
    .insert({
      org_id: parsed.data.orgId,
      property_id: parsed.data.propertyId,
      unit_id: parsed.data.unitId ?? null,
      utility_type: parsed.data.utilityType,
      meter_number: parsed.data.meterNumber ?? null,
      responsibility_mode: parsed.data.responsibilityMode,
      is_prepaid: parsed.data.isPrepaid,
      installed_date: parsed.data.installedDate ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'utility_meter_create_failed',
          message: safeErrorMessage(
            error,
            'Could not add this meter. Please try again, or contact support if this continues.',
            'utility_meters.insert',
          ),
        },
      },
      { status: 500 },
    );
  }

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: parsed.data.orgId,
    actorUserId: user.id,
    actorType: 'user',
    action: 'utility_meter.create',
    entityType: 'utility_meters',
    entityId: data.id,
    after: { utilityType: data.utility_type, meterNumber: data.meter_number, unitId: data.unit_id },
  });

  return NextResponse.json({ utilityMeter: mapRow(data) }, { status: 201 });
}
