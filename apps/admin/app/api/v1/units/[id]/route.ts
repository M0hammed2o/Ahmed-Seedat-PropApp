import { NextResponse, type NextRequest } from 'next/server';
import { unitUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapUnitRow, requireOrgRole } from '@/lib/portfolio';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

async function loadVisibleUnit(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  id: string,
) {
  return supabase.from('units').select('*').eq('id', id).maybeSingle();
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
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

  const { data, error } = await loadVisibleUnit(supabase, id);
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'unit_fetch_failed',
          message: safeErrorMessage(
            error,
            'Could not load this unit. Please try again, or contact support if this continues.',
            `units.fetch(${id})`,
          ),
        },
      },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Unit not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ unit: mapUnitRow(data) });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

  const { data: existing, error: fetchError } = await loadVisibleUnit(supabase, id);
  if (fetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'unit_fetch_failed',
          message: safeErrorMessage(
            fetchError,
            'Could not load this unit. Please try again, or contact support if this continues.',
            `units.fetch(${id})`,
          ),
        },
      },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Unit not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to edit this unit.' } },
      { status: 403 },
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

  const parsed = unitUpdateSchema.safeParse(body);
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

  // Stage 7: occupied/vacant is derived from lease activity (sync_unit_status_from_lease_trigger,
  // migration 20260101000079) -- this route must not let a direct PATCH create a contradictory
  // state (e.g. "occupied" with no active lease). `maintenance` remains the one manual, explicit
  // override, and only when the unit has no active lease -- exactly what that migration's own
  // comment says this file is responsible for gating.
  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    if (parsed.data.status === 'occupied') {
      return NextResponse.json(
        {
          error: {
            code: 'unit_status_derived',
            message:
              'A unit becomes occupied automatically once a lease is activated for it -- it cannot be set directly.',
          },
        },
        { status: 400 },
      );
    }

    if (parsed.data.status === 'maintenance') {
      const { data: activeLease, error: activeLeaseError } = await supabase
        .from('leases')
        .select('id')
        .eq('unit_id', id)
        .eq('status', 'active')
        .maybeSingle();
      if (activeLeaseError) {
        return NextResponse.json(
          {
            error: {
              code: 'unit_lease_check_failed',
              message: safeErrorMessage(
                activeLeaseError,
                "Could not verify this unit's lease status. Please try again, or contact support if this continues.",
                `units.checkActiveLease(${id})`,
              ),
            },
          },
          { status: 500 },
        );
      }
      if (activeLease) {
        return NextResponse.json(
          {
            error: {
              code: 'unit_has_active_lease',
              message:
                'This unit has an active lease and cannot be marked as under maintenance. End the lease first.',
            },
          },
          { status: 400 },
        );
      }
    }

    if (parsed.data.status === 'vacant' && existing.status === 'occupied') {
      return NextResponse.json(
        {
          error: {
            code: 'unit_status_derived',
            message:
              'This unit is occupied by an active lease -- end the lease to make it vacant, rather than setting the status directly.',
          },
        },
        { status: 400 },
      );
    }
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.unitLabel !== undefined) patch.unit_label = parsed.data.unitLabel;
  if (parsed.data.bedrooms !== undefined) patch.bedrooms = parsed.data.bedrooms;
  if (parsed.data.bathrooms !== undefined) patch.bathrooms = parsed.data.bathrooms;
  if (parsed.data.sizeSqm !== undefined) patch.size_sqm = parsed.data.sizeSqm;
  if (parsed.data.marketRent !== undefined) patch.market_rent = parsed.data.marketRent;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;

  const { data, error } = await supabase
    .from('units')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'unit_update_failed',
          message: safeErrorMessage(
            error,
            'Could not update this unit. Please try again, or contact support if this continues.',
            `units.update(${id})`,
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ unit: mapUnitRow(data) });
}
