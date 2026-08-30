import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/units/:id/archive -- wraps archive_unit() (migration 20260101000148). All
 * role/property-scope checks and the "no active lease" guard live in the function itself; this
 * route never terminates a lease or marks a unit vacant on its own.
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
  // used across every sibling lifecycle route -- archive_unit() is SECURITY DEFINER and would
  // otherwise return a permission error (not a 404) for a cross-org id, leaking that the id exists.
  const { data: visible, error: visibilityError } = await supabase
    .from('units')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (visibilityError) {
    return NextResponse.json(
      {
        error: {
          code: 'unit_fetch_failed',
          message: safeErrorMessage(visibilityError, 'Could not load this unit.', 'units/[id]/archive.visibility'),
        },
      },
      { status: 500 },
    );
  }
  if (!visible) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Unit not found.' } },
      { status: 404 },
    );
  }

  const { error } = await supabase.rpc('archive_unit', { p_unit_id: id });
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'unit_archive_failed',
          message: safeErrorMessage(error, 'Could not archive this unit.', 'units/[id]/archive.rpc'),
        },
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ archived: true });
}
