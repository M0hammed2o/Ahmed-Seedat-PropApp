import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireBillingPrincipalAccess } from '@/lib/portfolio';
import { renderSubscriptionInvoicePdf } from '@/lib/subscriptionInvoicePdf';

type RouteParams = { params: Promise<{ orgId: string; invoiceId: string }> };

/**
 * GET /api/v1/organizations/:orgId/billing/invoices/:invoiceId/pdf -- V1 billing invoice pass
 * (WORKLOG.md this date). Generates the PDF live, on every request -- deliberately NOT a stored
 * object behind a signed URL (the `documents` bucket's own pattern): there is nothing to expire or
 * leak, because there is no persisted URL at all. Every request re-authenticates and re-checks org
 * access from scratch, matching Phase 9's "URLs are not globally public indefinitely" requirement
 * by construction rather than by TTL.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { orgId, invoiceId } = await params;
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
          message: 'Only the organization principal can download subscription invoices.',
        },
      },
      { status: 403 },
    );
  }

  const { data: invoice, error } = await supabase
    .from('subscription_invoices')
    .select(
      '*, plans!subscription_invoices_plan_id_fkey(name, base_price), organizations!subscription_invoices_org_id_fkey(legal_name, trading_name), subscription_payments!subscription_invoices_subscription_payment_id_fkey(provider_reference, purpose)',
    )
    .eq('id', invoiceId)
    // Belt-and-suspenders on top of RLS: the URL's own orgId must match the invoice's real org,
    // never trust the path segment alone to scope the query.
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'invoice_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!invoice) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Invoice not found.' } },
      { status: 404 },
    );
  }

  let previousPlanName: string | null = null;
  if (invoice.billing_plan_change_id) {
    const { data: change } = await supabase
      .from('billing_plan_changes')
      .select('old_plan_id, plans!billing_plan_changes_old_plan_id_fkey(name)')
      .eq('id', invoice.billing_plan_change_id)
      .maybeSingle();
    previousPlanName = (change?.plans as unknown as { name: string } | null)?.name ?? null;
  }

  const plan = invoice.plans as { name: string; base_price: number } | null;
  const org = invoice.organizations as { legal_name: string; trading_name: string | null } | null;
  const payment = invoice.subscription_payments as
    | { provider_reference: string | null; purpose: string | null }
    | null;

  const pdfBuffer = await renderSubscriptionInvoicePdf({
    invoiceNumber: invoice.invoice_number,
    invoiceType: invoice.invoice_type,
    status: invoice.status,
    issuedAt: invoice.issued_at,
    paidAt: invoice.paid_at,
    currency: invoice.currency,
    subtotal: Number(invoice.subtotal),
    discountAmount: Number(invoice.discount_amount),
    total: Number(invoice.total),
    billingPeriodStart: invoice.billing_period_start,
    billingPeriodEnd: invoice.billing_period_end,
    orgName: org?.trading_name ?? org?.legal_name ?? 'Organization',
    planName: plan?.name ?? 'Plan',
    previousPlanName,
    newPlanRecurringPrice:
      invoice.invoice_type === 'upgrade' || invoice.invoice_type === 'reactivation'
        ? (plan?.base_price ?? null)
        : null,
    paymentReference: payment?.provider_reference ?? null,
    paymentPurpose: payment?.purpose ?? null,
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoice.invoice_number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
