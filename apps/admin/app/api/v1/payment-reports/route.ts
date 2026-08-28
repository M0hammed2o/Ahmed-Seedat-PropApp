import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPaymentReportRow } from '@/lib/paymentReports';
import { safeErrorMessage } from '@/lib/safeError';

/**
 * GET /api/v1/payment-reports -- WhatsApp V1 completion pass, Phase B (WORKLOG.md this date). The
 * review-listing route for owners/staff. Deliberately no service-role bypass and no extra
 * application-layer authorization -- payment_reports_select_staff_or_owner/
 * payment_reports_select_tenant_self (migration 20260101000106) are the real, sole enforcement:
 * the caller's own session-bound client only ever returns rows RLS already says they're allowed
 * to see (their own org+property-scoped reports if staff/owner, or their own reports if a
 * tenant -- this route is also reachable from the tenant portal to show a tenant their own report
 * history, not staff-only).
 */
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
  const propertyIdFilter = url.searchParams.get('filter[property_id]');
  const statusFilter = url.searchParams.get('filter[status]');

  let query = supabase
    .from('payment_reports')
    .select('*, tenants(full_name), properties(nickname)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (propertyIdFilter) query = query.eq('property_id', propertyIdFilter);
  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'payment_reports_list_failed',
          message: safeErrorMessage(error, 'Could not load payment reports.', 'paymentReports.list'),
        },
      },
      { status: 500 },
    );
  }

  // Row mapper output plus two display-only joined fields (never persisted, never round-tripped
  // back into a write) -- the review UI needs a tenant name/property label, not just ids.
  const paymentReports = (data ?? []).map((row) => ({
    ...mapPaymentReportRow(row),
    tenantName:
      (row as unknown as { tenants: { full_name: string } | null }).tenants?.full_name ?? null,
    propertyName:
      (row as unknown as { properties: { nickname: string } | null }).properties?.nickname ?? null,
  }));

  return NextResponse.json({ paymentReports });
}
