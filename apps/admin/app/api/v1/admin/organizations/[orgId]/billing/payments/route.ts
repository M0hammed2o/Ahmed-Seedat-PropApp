import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * GET /api/v1/admin/organizations/:orgId/billing/payments -- read_only_admin+, "Super Admin
 * visibility of payment state" (this milestone's own requirement). Lists subscription_payments,
 * newest first.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('read_only_admin');
  if ('response' in guard) return guard.response;

  const { orgId } = await params;
  const serviceClient = getServiceRoleClient();

  const { data, error } = await serviceClient
    .from('subscription_payments')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: 'subscription_payments_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    subscriptionPayments: (data ?? []).map((row) => ({
      id: row.id,
      orgId: row.org_id,
      subscriptionId: row.subscription_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      paymentMethod: row.payment_method,
      providerReference: row.provider_reference,
      paidAt: row.paid_at,
      createdAt: row.created_at,
    })),
  });
}
