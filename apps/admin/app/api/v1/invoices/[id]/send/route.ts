import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { mapInvoiceRow } from '@/lib/accounting';
import { requireOrgRole } from '@/lib/portfolio';
import { dispatchEmail } from '@/lib/emailDispatch';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/invoices/:id/send -- the ONLY thing that ever emails a tenant an invoice.
 * Deliberately separate from invoice creation (POST /api/v1/rent-schedules/:id/invoice) so
 * "Invoice exists" and "Invoice sent to tenant" stay two distinct, explicitly-triggered actions --
 * an internal (no-portal) tenant with no email address is a normal, safe outcome here (dispatchEmail
 * no-ops for a null address), never an error. Idempotency (one email per invoice+template) is
 * enforced inside dispatchEmail() itself.
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

  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_fetch_failed',
          message: safeErrorMessage(fetchError, 'Could not load this invoice.', 'invoices/[id]/send.fetch'),
        },
      },
      { status: 500 },
    );
  }
  if (!invoice) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Invoice not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, invoice.org_id, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to send this invoice.' } },
      { status: 403 },
    );
  }

  const serviceClient = getServiceRoleClient();
  const { data: tenant } = await serviceClient
    .from('tenants')
    .select('email')
    .eq('id', invoice.tenant_id)
    .maybeSingle();

  if (!tenant?.email) {
    return NextResponse.json(
      {
        error: {
          code: 'tenant_has_no_email',
          message:
            'This tenant has no email address on file (internal tenants may not have one) -- there is no way to send this invoice electronically. Share it manually instead.',
        },
      },
      { status: 409 },
    );
  }

  const { data: leaseRow } = await serviceClient
    .from('leases')
    .select('units(properties(nickname))')
    .eq('id', invoice.lease_id)
    .maybeSingle();
  const propertyAddress = (leaseRow as { units?: { properties?: { nickname?: string } } } | null)
    ?.units?.properties?.nickname;

  // dispatchEmail() only ever returns sent:false for an intentional skip (already sent,
  // suppressed, notification preference disabled) -- never for a genuine send failure, which
  // throws instead (its own insertError.message throw). So any non-throwing result here means the
  // send was already handled (or intentionally not repeated); only a thrown error is a real 502.
  let dispatchResult;
  try {
    dispatchResult = await dispatchEmail(serviceClient, {
      orgId: invoice.org_id,
      toAddress: tenant.email,
      templateName: 'invoice_issued',
      templateVars: { propertyAddress, amount: invoice.amount, period: invoice.period },
      relatedEntityType: 'invoice',
      relatedEntityId: invoice.id,
      actorUserId: user.id,
    });
  } catch (err) {
    console.error('[invoices/[id]/send] dispatchEmail failed', err);
    return NextResponse.json(
      {
        error: {
          code: 'invoice_send_failed',
          message: 'Could not send this invoice email. Please try again, or contact support if this continues.',
        },
      },
      { status: 502 },
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from('invoices')
    .update({ emailed_at: new Date().toISOString() })
    .eq('id', id)
    .is('emailed_at', null)
    .select('*')
    .maybeSingle();
  if (updateError) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_update_failed',
          message: safeErrorMessage(
            updateError,
            'The email was sent, but the invoice record could not be updated. Please refresh.',
            'invoices/[id]/send.update',
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    invoice: mapInvoiceRow(updated ?? invoice),
    dispatch: { sent: dispatchResult.sent, reason: dispatchResult.reason ?? null },
  });
}
