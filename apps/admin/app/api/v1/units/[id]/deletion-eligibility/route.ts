import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/units/:id/deletion-eligibility -- read-only wrapper over
 * get_unit_deletion_blockers() (migration 20260101000148). Lets the UI decide whether to offer
 * "Delete permanently" at all, or only "Archive" -- the authoritative check is re-run server-side
 * again inside hard_delete_unit() itself when the action is actually attempted, this is only ever
 * used for display.
 */
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

  const { data: existing, error: fetchError } = await supabase
    .from('units')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'unit_fetch_failed',
          message: safeErrorMessage(fetchError, 'Could not load this unit.', 'units/[id]/deletion-eligibility.fetch'),
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

  const { data: blockers, error } = await supabase.rpc('get_unit_deletion_blockers', {
    p_unit_id: id,
  });
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'deletion_eligibility_check_failed',
          message: safeErrorMessage(
            error,
            'Could not check whether this unit is eligible for permanent deletion.',
            'units/[id]/deletion-eligibility.rpc',
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ eligible: (blockers ?? []).length === 0, blockers: blockers ?? [] });
}
