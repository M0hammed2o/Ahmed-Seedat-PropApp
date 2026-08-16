import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { dispatchWhatsApp, resolveOrgWhatsAppBranding } from '@/lib/whatsappDispatch';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/payment-reports/:id/confirm -- WhatsApp V1 completion pass, Phase B (WORKLOG.md
 * this date). Thin wrapper over confirm_payment_report() (migration 20260101000106) -- accountant+
 * acknowledges a reported payment. Deliberately does NOT touch the ledger/rent_schedules (see the
 * migration's own header comment) -- the real accounting confirmation
 * (confirm_cash_receipt_deposit()/confirm_bank_transaction_match()) remains a completely separate,
 * unchanged staff action. Dispatches payment_received_confirmation to the tenant only after the
 * RPC returns success=true, matching Phase B's explicit "tenant receives ... only after
 * confirmation" requirement.
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

  const { data: rpcRows, error: rpcError } = await supabase
    .rpc('confirm_payment_report', { p_payment_report_id: id })
    .single();
  if (rpcError) {
    return NextResponse.json(
      { error: { code: 'payment_report_confirm_failed', message: rpcError.message } },
      { status: 500 },
    );
  }

  const result = rpcRows as {
    success: boolean;
    error_code: string | null;
    org_id: string | null;
    tenant_id: string | null;
    amount: number | null;
  };

  if (!result.success) {
    const status =
      result.error_code === 'forbidden' ? 403 : result.error_code === 'not_found' ? 404 : 409;
    return NextResponse.json(
      {
        error: {
          code: result.error_code ?? 'unknown',
          message: 'Could not confirm this payment report.',
        },
      },
      { status },
    );
  }

  const serviceClient = getServiceRoleClient();

  await writeAuditEvent(serviceClient, {
    orgId: result.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'payment_report.confirmed',
    entityType: 'payment_reports',
    entityId: id,
    after: { amount: result.amount, tenantId: result.tenant_id },
  });

  if (result.org_id && result.tenant_id) {
    try {
      const { data: tenant } = await serviceClient
        .from('tenants')
        .select('phone, user_id')
        .eq('id', result.tenant_id)
        .maybeSingle();
      const branding = await resolveOrgWhatsAppBranding(serviceClient, result.org_id);

      await dispatchWhatsApp(serviceClient, {
        orgId: result.org_id,
        toPhone: tenant?.phone ?? null,
        toUserId: tenant?.user_id ?? null,
        templateName: 'payment_received_confirmation',
        variables: {
          organizationName: branding.organizationName,
          amount: String(result.amount ?? ''),
        },
        relatedEntityType: 'payment_report',
        relatedEntityId: id,
        actorUserId: user.id,
      });
    } catch (err) {
      console.error(
        '[notificationDispatch] payment_received_confirmation (report) dispatch failed',
        err,
      );
    }
  }

  return NextResponse.json({ confirmed: true });
}
