import { NextResponse, type NextRequest } from 'next/server';
import { bankTransactionConfirmMatchSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { mapBankTransactionRow } from '@/lib/accounting';
import { dispatchEmail } from '@/lib/emailDispatch';
import { dispatchWhatsApp } from '@/lib/whatsappDispatch';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/bank-transactions/:id/confirm-match (API_SPEC.md §6). Thin wrapper over
 * confirm_bank_transaction_match() (migration 20260101000038) -- the rent-payment case only
 * (matches a bank transaction to a rent_schedule). Confirmation is always an explicit staff
 * action (ACCOUNTING.md §8: "never auto-confirms") -- there is no separate "propose" step in
 * this V1 implementation (the evidenced `calculateMatchScore` proposal step for rent payments is
 * not yet wired in here; the caller currently supplies which rent_schedule to match against
 * directly).
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

  const parsed = bankTransactionConfirmMatchSchema.safeParse(body);
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

  const { error: matchError } = await supabase.rpc('confirm_bank_transaction_match', {
    p_bank_transaction_id: id,
    p_rent_schedule_id: parsed.data.rentScheduleId,
  });

  if (matchError) {
    return NextResponse.json(
      { error: { code: 'confirm_match_failed', message: matchError.message } },
      { status: 500 },
    );
  }

  const { data, error: fetchError } = await supabase
    .from('bank_transactions')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'bank_transaction_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  try {
    const serviceClient = getServiceRoleClient();
    const { data: schedule } = await serviceClient
      .from('rent_schedules')
      .select('org_id, amount, lease_id')
      .eq('id', parsed.data.rentScheduleId)
      .maybeSingle();
    if (schedule) {
      const { data: primaryTenant } = await serviceClient
        .from('lease_tenants')
        .select('tenants(email, phone)')
        .eq('lease_id', schedule.lease_id)
        .eq('is_primary', true)
        .maybeSingle();
      const tenant = (primaryTenant as { tenants?: { email?: string; phone?: string } } | null)
        ?.tenants;

      await dispatchEmail(serviceClient, {
        orgId: schedule.org_id,
        toAddress: tenant?.email ?? null,
        templateName: 'payment_recorded',
        templateVars: { amount: Math.abs(data.amount) },
        relatedEntityType: 'bank_transaction',
        relatedEntityId: data.id,
        actorUserId: user.id,
      });

      await dispatchWhatsApp(serviceClient, {
        orgId: schedule.org_id,
        toPhone: tenant?.phone ?? null,
        // WhatsApp production readiness pass (WORKLOG.md this date): renamed from
        // 'payment_accepted' to match the real Meta-approved template -- variable structure
        // (single `amount`) carried over UNVERIFIED; see this route's own dispatch below and the
        // session's readiness report for the same caveat.
        templateName: 'payment_received_confirmation',
        variables: { amount: String(Math.abs(data.amount)) },
        relatedEntityType: 'bank_transaction',
        relatedEntityId: data.id,
        actorUserId: user.id,
      });
    }
  } catch (err) {
    console.error('[notificationDispatch] payment confirmation dispatch failed', err);
  }

  return NextResponse.json({ bankTransaction: mapBankTransactionRow(data) });
}
