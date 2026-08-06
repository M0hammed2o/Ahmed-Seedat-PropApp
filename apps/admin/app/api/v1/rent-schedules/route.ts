import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/** GET /api/v1/rent-schedules?status=overdue (API_SPEC.md §6). Read-only; created only via approve_application(). */
export async function GET(request: NextRequest) {
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

  const url = new URL(request.url);
  const orgIdFilter = url.searchParams.get('org_id');
  const statusFilter = url.searchParams.get('status');

  let query = supabase.from('rent_schedules').select('*').order('due_date', { ascending: true });
  if (orgIdFilter) query = query.eq('org_id', orgIdFilter);
  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'rent_schedules_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rentSchedules = (data ?? []).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    leaseId: row.lease_id,
    dueDate: row.due_date,
    amount: row.amount,
    status: row.status,
    generatedAt: row.generated_at,
  }));

  return NextResponse.json({ rentSchedules });
}
