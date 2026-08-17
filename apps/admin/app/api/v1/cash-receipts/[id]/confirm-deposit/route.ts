import { NextResponse, type NextRequest } from 'next/server';
import { cashReceiptConfirmDepositSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { mapCashReceiptRow } from '@/lib/accounting';
import {
  dispatchWhatsApp,
  resolvePropertyLabel,
  formatPaymentPeriod,
} from '@/lib/whatsappDispatch';
import { buildPaymentReceivedConfirmationVariables } from '@/lib/whatsappTemplateVariables';
import { getAppUrl } from '@/lib/appUrl';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/cash-receipts/:id/confirm-deposit (Stage 3 Phase 7, commercial-launch execution
 * plan). Thin wrapper over confirm_cash_receipt_deposit() (migration 20260101000073) -- posts the
 * Dr Bank/Cr Accounts Receivable entry for the deposited amount and records the variance against
 * what was originally received.
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

  const parsed = cashReceiptConfirmDepositSchema.safeParse(body);
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

  const { error: confirmError } = await supabase.rpc('confirm_cash_receipt_deposit', {
    p_cash_receipt_id: id,
    p_bank_transaction_id: parsed.data.bankTransactionId,
    p_deposited_amount: parsed.data.depositedAmount,
  });
  if (confirmError) {
    return NextResponse.json(
      { error: { code: 'cash_receipt_confirm_failed', message: confirmError.message } },
      { status: 422 },
    );
  }

  const { data, error } = await supabase.from('cash_receipts').select('*').eq('id', id).single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'cash_receipt_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  // WhatsApp production readiness pass (WORKLOG.md this date): a genuine gap found while auditing
  // the payment-confirmation lifecycle -- confirm_bank_transaction_match()'s own route already
  // notified the tenant on confirmed payment (payment_received_confirmation), but this cash-deposit
  // equivalent never did, despite being the exact same "reported -> confirmed" transition
  // (record_cash_receipt() logs the report; THIS call is the confirmation, migration
  // 20260101000073's own two-step design). Mirrors that route's pattern exactly: best-effort,
  // never blocks the response, only fires when the receipt is actually tied to a lease (a
  // standalone cash receipt with no lease_id has no tenant to notify).
  if (data.lease_id) {
    try {
      const serviceClient = getServiceRoleClient();
      const { data: primaryTenant } = await serviceClient
        .from('lease_tenants')
        .select('tenants(phone)')
        .eq('lease_id', data.lease_id)
        .eq('is_primary', true)
        .maybeSingle();
      const tenant = (primaryTenant as { tenants?: { phone?: string } } | null)?.tenants;
      const propertyLabel = await resolvePropertyLabel(serviceClient, data.property_id);

      await dispatchWhatsApp(serviceClient, {
        orgId: data.org_id,
        toPhone: tenant?.phone ?? null,
        // Final pre-production pass (WORKLOG.md 2026-08-17): real approved structure confirmed by
        // Mohammed -- amount, propertyLabel, paymentPeriod, dateConfirmed, accountLink (5 vars).
        templateName: 'payment_received_confirmation',
        variables: buildPaymentReceivedConfirmationVariables({
          amount: String(data.deposited_amount ?? data.amount),
          propertyLabel,
          paymentPeriod: formatPaymentPeriod(data.received_at ?? new Date().toISOString()),
          dateConfirmed: new Date().toLocaleDateString('en-ZA'),
          accountLink: `${getAppUrl()}/my-payments`,
        }),
        relatedEntityType: 'cash_receipt',
        relatedEntityId: data.id,
        actorUserId: user.id,
      });
    } catch (err) {
      console.error(
        '[notificationDispatch] payment_received_confirmation (cash) dispatch failed',
        err,
      );
    }
  }

  return NextResponse.json({ cashReceipt: mapCashReceiptRow(data) });
}
