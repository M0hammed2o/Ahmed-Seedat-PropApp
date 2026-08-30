import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/properties/:id/hard-delete -- the ONLY route that ever issues a real, permanent
 * DELETE of a properties row. Deliberately separate from DELETE /api/v1/properties/:id (archive) --
 * a different verb-and-path pair is used specifically so the two can never be confused by an
 * automated client or a careless future call site. All eligibility/role checks live in
 * hard_delete_property() itself (migration 20260101000148, principal + owner-level property
 * access, re-validates get_property_deletion_blockers() server-side) -- this route is a thin
 * wrapper, never trusts a prior client-side eligibility read.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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

  // Visibility check via RLS-scoped read first, same "404 not 403 for a hidden row" convention
  // used across every sibling lifecycle route -- hard_delete_property() is SECURITY DEFINER and
  // would otherwise return a permission error (not a 404) for a cross-org id, leaking that the id
  // exists.
  const { data: visible, error: visibilityError } = await supabase
    .from('properties')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (visibilityError) {
    return NextResponse.json(
      {
        error: {
          code: 'property_fetch_failed',
          message: safeErrorMessage(
            visibilityError,
            'Could not load this property.',
            'properties/[id]/hard-delete.visibility',
          ),
        },
      },
      { status: 500 },
    );
  }
  if (!visible) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }

  const { error } = await supabase.rpc('hard_delete_property', { p_property_id: id });
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'property_hard_delete_failed',
          message: safeErrorMessage(
            error,
            'Could not permanently delete this property.',
            'properties/[id]/hard-delete.rpc',
          ),
        },
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ deleted: true });
}
