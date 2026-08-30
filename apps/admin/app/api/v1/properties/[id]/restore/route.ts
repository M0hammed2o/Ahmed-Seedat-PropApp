import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPropertyRow } from '@/lib/portfolio';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/properties/:id/restore -- thin wrapper over restore_property() (migration
 * 20260101000149), the missing counterpart to DELETE (archive). Same agent+ / property-scoped
 * permission floor as archive itself; no eligibility check needed (restoring an archived property
 * back to active can never be unsafe the way deleting one can).
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
  // used across every sibling lifecycle route -- restore_property() is SECURITY DEFINER and would
  // otherwise return a permission error (not a 404) for a cross-org id, leaking that the id exists.
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
            'properties/[id]/restore.visibility',
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

  const { error } = await supabase.rpc('restore_property', { p_property_id: id });
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'property_restore_failed',
          message: safeErrorMessage(
            error,
            'Could not restore this property. Please try again, or contact support if this continues.',
            'properties/[id]/restore.rpc',
          ),
        },
      },
      { status: 409 },
    );
  }

  const { data, error: fetchError } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError || !data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ property: mapPropertyRow(data) });
}
