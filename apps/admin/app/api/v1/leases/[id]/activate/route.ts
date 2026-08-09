import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapLeaseRow } from '@/lib/leasing';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/leases/:id/activate -- replaces the old bare "PATCH status=active" (which accepted
 * any enum member with zero business-rule checking). Delegates entirely to activate_lease()
 * (migration 20260101000078): validates a tenant is assigned, rent > 0, start_date is set, and no
 * other active lease exists on the unit, then flips status and generates the first rent-schedule
 * pass. Idempotent -- re-activating an already-active lease is a no-op success, not an error.
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

  const { data, error } = await supabase.rpc('activate_lease', { p_lease_id: id });

  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_activation_failed', message: error.message } },
      { status: 400 },
    );
  }

  return NextResponse.json({ lease: mapLeaseRow(data) });
}
