import { NextResponse, type NextRequest } from 'next/server';
import { billingRefundSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { refundSubscriptionPayment } from '@/lib/billing';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/admin/subscription-payments/:id/refund -- super_admin only. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('super_admin');
  if ('response' in guard) return guard.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = billingRefundSchema.safeParse(body);
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

  const serviceClient = getServiceRoleClient();

  try {
    await refundSubscriptionPayment(serviceClient, {
      subscriptionPaymentId: id,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    await writeAuditEvent(serviceClient, {
      orgId: null,
      actorUserId: guard.session.authUserId,
      actorType: 'user',
      action: 'billing.payment_refunded',
      entityType: 'subscription_payments',
      entityId: id,
    });

    return NextResponse.json({ status: 'refunded' });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'billing_refund_failed',
          message: err instanceof Error ? err.message : 'Refund failed.',
        },
      },
      { status: 422 },
    );
  }
}
