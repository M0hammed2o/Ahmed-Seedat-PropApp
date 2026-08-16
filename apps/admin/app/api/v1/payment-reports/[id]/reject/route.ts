import { NextResponse, type NextRequest } from 'next/server';
import { paymentReportRejectSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/payment-reports/:id/reject -- WhatsApp V1 completion pass, Phase B. Thin wrapper
 * over reject_payment_report() (migration 20260101000106). No WhatsApp dispatch on rejection --
 * the task's own spec only names payment_received_confirmation as the confirm-side notification;
 * a rejected report stays visible to the tenant in-app (payment_reports_select_tenant_self RLS)
 * without a separate WhatsApp send.
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

  const parsed = paymentReportRejectSchema.safeParse(body);
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

  const { data: rpcRows, error: rpcError } = await supabase
    .rpc('reject_payment_report', { p_payment_report_id: id, p_reason: parsed.data.reason })
    .single();
  if (rpcError) {
    return NextResponse.json(
      { error: { code: 'payment_report_reject_failed', message: rpcError.message } },
      { status: 500 },
    );
  }

  const result = rpcRows as { success: boolean; error_code: string | null };
  if (!result.success) {
    const status =
      result.error_code === 'forbidden' ? 403 : result.error_code === 'not_found' ? 404 : 409;
    return NextResponse.json(
      {
        error: {
          code: result.error_code ?? 'unknown',
          message: 'Could not reject this payment report.',
        },
      },
      { status },
    );
  }

  const { data: report } = await supabase
    .from('payment_reports')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: report?.org_id ?? null,
    actorUserId: user.id,
    actorType: 'user',
    action: 'payment_report.rejected',
    entityType: 'payment_reports',
    entityId: id,
    after: { reason: parsed.data.reason },
  });

  return NextResponse.json({ rejected: true });
}
