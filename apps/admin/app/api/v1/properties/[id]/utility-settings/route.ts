import { NextResponse, type NextRequest } from 'next/server';
import { utilityResponsibilitySetSchema } from '@propvault/validation';
import type { UtilityResponsibilitySetting } from '@propvault/types';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

interface UtilityResponsibilitySettingRow {
  id: string;
  org_id: string;
  property_id: string;
  unit_id: string | null;
  utility_type: 'water' | 'electricity';
  responsibility_mode: UtilityResponsibilitySetting['responsibilityMode'];
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: UtilityResponsibilitySettingRow): UtilityResponsibilitySetting {
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    unitId: row.unit_id,
    utilityType: row.utility_type,
    responsibilityMode: row.responsibility_mode,
    active: row.active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET/POST /api/v1/properties/:id/utility-settings -- water/electricity responsibility mode
 * (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §1C, migration 20260101000163). POST deactivates any
 * existing active row for the same (scope, utility_type) before inserting the new one -- the
 * partial unique index only allows one active row per scope+utility_type, so this mirrors
 * set_recurring_property_cost()'s "close out the old one first" shape without needing a second RPC
 * for what is a live toggle, not effective-dated history.
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
    .from('utility_responsibility_settings')
    .select('*')
    .eq('property_id', id)
    .eq('active', true)
    .order('utility_type', { ascending: true });
  if (unitId) query = query.eq('unit_id', unitId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'utility_settings_list_failed',
          message: safeErrorMessage(error, 'Could not load utility settings.', 'utility_responsibility_settings.list'),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ utilitySettings: (data ?? []).map(mapRow) });
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

  const parsed = utilityResponsibilitySetSchema.safeParse({ ...(body as object), propertyId: id });
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
  if (parsed.data.responsibilityMode === 'common_area_owner' && parsed.data.unitId) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'common_area_owner cannot be set on a specific unit -- it is property-wide.',
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
          message: 'You do not have permission to set utility responsibility for this organization.',
        },
      },
      { status: 403 },
    );
  }

  let deactivateQuery = supabase
    .from('utility_responsibility_settings')
    .update({ active: false })
    .eq('property_id', parsed.data.propertyId)
    .eq('utility_type', parsed.data.utilityType)
    .eq('active', true);
  deactivateQuery = parsed.data.unitId
    ? deactivateQuery.eq('unit_id', parsed.data.unitId)
    : deactivateQuery.is('unit_id', null);
  await deactivateQuery;

  const { data, error } = await supabase
    .from('utility_responsibility_settings')
    .insert({
      org_id: parsed.data.orgId,
      property_id: parsed.data.propertyId,
      unit_id: parsed.data.unitId ?? null,
      utility_type: parsed.data.utilityType,
      responsibility_mode: parsed.data.responsibilityMode,
      notes: parsed.data.notes ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'utility_setting_create_failed',
          message: safeErrorMessage(
            error,
            'Could not set utility responsibility. Please try again, or contact support if this continues.',
            'utility_responsibility_settings.insert',
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
    action: 'utility_responsibility_setting.set',
    entityType: 'utility_responsibility_settings',
    entityId: data.id,
    after: { utilityType: data.utility_type, responsibilityMode: data.responsibility_mode, unitId: data.unit_id },
  });

  return NextResponse.json({ utilitySetting: mapRow(data) }, { status: 201 });
}
