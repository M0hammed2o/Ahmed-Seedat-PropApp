import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireBillingPrincipalAccess } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * GET /api/v1/organizations/:orgId/billing/invoices -- V1 billing invoice pass (WORKLOG.md this
 * date). Lists this org's own subscription_invoices (Proplyst's own SaaS-fee invoices/receipts,
 * never the landlord/tenant accounting invoices). Gated by requireBillingPrincipalAccess, matching
 * every other /billing/* route and the billing page's own principal-only gate -- on top of, not
 * instead of, subscription_invoices' own RLS select policy (org membership), which independently
 * makes cross-org rows unreachable even if this check were ever bypassed.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
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

  const isPrincipal = await requireBillingPrincipalAccess(supabase, orgId);
  if (!isPrincipal) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Only the organization principal can view subscription invoices.',
        },
      },
      { status: 403 },
    );
  }

  const { data: rows, error } = await supabase
    .from('subscription_invoices')
    .select('*, plans!subscription_invoices_plan_id_fkey(name)')
    .eq('org_id', orgId)
    .order('issued_at', { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json(
      { error: { code: 'invoices_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  const invoices = (rows ?? []).map((row) => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    invoiceType: row.invoice_type,
    planName: (row.plans as { name: string } | null)?.name ?? null,
    billingPeriodStart: row.billing_period_start,
    billingPeriodEnd: row.billing_period_end,
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount),
    total: Number(row.total),
    currency: row.currency,
    status: row.status,
    issuedAt: row.issued_at,
    paidAt: row.paid_at,
  }));

  return NextResponse.json({ invoices });
}
