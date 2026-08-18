import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * GET /api/v1/admin/organizations/:orgId/billing/invoices -- V1 billing invoice pass (WORKLOG.md
 * this date). read_only_admin+, mirroring billing/payments/route.ts's own gate exactly -- read-only
 * visibility into a client's Proplyst subscription-invoice history for platform staff/support, not
 * a separate accounting surface.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('read_only_admin');
  if ('response' in guard) return guard.response;

  const { orgId } = await params;
  const serviceClient = getServiceRoleClient();

  const { data, error } = await serviceClient
    .from('subscription_invoices')
    .select('*, plans!subscription_invoices_plan_id_fkey(name)')
    .eq('org_id', orgId)
    .order('issued_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: 'subscription_invoices_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    invoices: (data ?? []).map((row) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      invoiceType: row.invoice_type,
      planName: (row.plans as { name: string } | null)?.name ?? null,
      total: Number(row.total),
      currency: row.currency,
      status: row.status,
      issuedAt: row.issued_at,
    })),
  });
}
