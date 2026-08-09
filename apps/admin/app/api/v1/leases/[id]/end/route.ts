import { NextResponse, type NextRequest } from 'next/server';
import { leaseEndSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapLeaseRow } from '@/lib/leasing';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/leases/:id/end -- the mirror of /activate. Delegates to end_lease() (migration
 * 20260101000078): only an active lease can be ended, target status must be expired or
 * terminated. The unit's status reverts to vacant via sync_unit_status_from_lease_trigger
 * (migration 20260101000079), not this route.
 */
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

  const parsed = leaseEndSchema.safeParse(body);
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

  const { data, error } = await supabase.rpc('end_lease', {
    p_lease_id: id,
    p_status: parsed.data.status,
  });

  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_end_failed', message: error.message } },
      { status: 400 },
    );
  }

  return NextResponse.json({ lease: mapLeaseRow(data) });
}
