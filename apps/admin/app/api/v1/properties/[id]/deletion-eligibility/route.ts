import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/properties/:id/deletion-eligibility -- read-only wrapper over
 * get_property_deletion_blockers() (migration 20260101000148). Lets the UI decide whether to
 * offer "Delete permanently" at all, or only "Archive" -- the authoritative check is re-run
 * server-side again inside hard_delete_property() itself when the action is actually attempted,
 * this is only ever used for display.
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

  // Visibility check via RLS-scoped read first, same "404 not 403 for a hidden row" convention as
  // the sibling routes -- the RPC itself is also RLS-agnostic (SECURITY DEFINER), so this read is
  // what actually enforces "you must be able to see this property to ask about it."
  const { data: existing, error: fetchError } = await supabase
    .from('properties')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'property_fetch_failed',
          message: safeErrorMessage(fetchError, 'Could not load this property.', 'properties/[id]/deletion-eligibility.fetch'),
        },
      },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }

  const { data: blockers, error } = await supabase.rpc('get_property_deletion_blockers', {
    p_property_id: id,
  });
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'deletion_eligibility_check_failed',
          message: safeErrorMessage(
            error,
            'Could not check whether this property is eligible for permanent deletion.',
            'properties/[id]/deletion-eligibility.rpc',
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ eligible: (blockers ?? []).length === 0, blockers: blockers ?? [] });
}
