import { NextResponse, type NextRequest } from 'next/server';
import { invoiceVoidSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInvoiceRow } from '@/lib/accounting';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/invoices/:id/void -- void_invoice() (migration 20260101000158). Never deletes the
 * invoice; refuses if any non-reversed payment exists on it (reverse first) or if it is already
 * void. Same explicit-action pattern as invoices/:id/issue.
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

  const { data: existing, error: fetchError } = await supabase
    .from('invoices')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'invoice_fetch_failed', message: safeErrorMessage(fetchError, 'Could not load this invoice.', 'invoices/[id]/void.fetch') } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Invoice not found.' } }, { status: 404 });
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to void this invoice.' } },
      { status: 403 },
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

  const parsed = invoiceVoidSchema.safeParse(body);
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

  const { error: rpcError } = await supabase.rpc('void_invoice', {
    p_invoice_id: id,
    p_reason: parsed.data.reason,
  });
  if (rpcError) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_void_failed',
          message: safeErrorMessage(rpcError, 'Could not void this invoice.', 'invoices/[id]/void'),
        },
      },
      { status: 400 },
    );
  }

  const { data: invoice, error: reloadError } = await supabase.from('invoices').select('*').eq('id', id).single();
  if (reloadError) {
    return NextResponse.json(
      { error: { code: 'invoice_fetch_failed', message: 'Invoice was voided, but could not be reloaded. Please refresh.' } },
      { status: 500 },
    );
  }

  return NextResponse.json({ invoice: mapInvoiceRow(invoice) });
}
