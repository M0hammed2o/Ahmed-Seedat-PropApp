import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapRentScheduleRow } from '@/lib/leasing';

type RouteParams = { params: Promise<{ id: string }> };

/** GET /api/v1/leases/:id/rent-schedule (API_SPEC.md §4) -- what the Rent Due dashboard reads. */
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

  const { data: lease, error: leaseError } = await supabase
    .from('leases')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (leaseError) {
    return NextResponse.json(
      { error: { code: 'lease_fetch_failed', message: leaseError.message } },
      { status: 500 },
    );
  }
  if (!lease) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Lease not found.' } },
      { status: 404 },
    );
  }

  const { data, error } = await supabase
    .from('rent_schedules')
    .select('*')
    .eq('lease_id', id)
    .order('due_date', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: { code: 'rent_schedule_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ rentSchedule: (data ?? []).map(mapRentScheduleRow) });
}
