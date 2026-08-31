import { NextResponse, type NextRequest } from 'next/server';
import { manualInvoiceUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInvoiceRow, mapInvoiceLineItemRow } from '@/lib/accounting';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/invoices/:id -- invoice header + real line items (invoice_line_items,
 * migration 20260101000152). Rent-schedule invoices have no real line-item rows (they synthesize
 * one virtual line at display time, apps/admin/lib/invoicing.ts) so lineItems comes back empty for
 * those -- callers should treat an empty array as "not a manual invoice", not an error.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
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

  const { data: invoice, error } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'invoice_fetch_failed', message: safeErrorMessage(error, 'Could not load this invoice.', 'invoices/[id].fetch') } },
      { status: 500 },
    );
  }
  if (!invoice) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Invoice not found.' } }, { status: 404 });
  }

  const { data: lineItems, error: lineError } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', id)
    .order('sort_order', { ascending: true });
  if (lineError) {
    return NextResponse.json(
      { error: { code: 'invoice_line_items_fetch_failed', message: safeErrorMessage(lineError, 'Could not load invoice line items.', 'invoices/[id].lineItems') } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    invoice: mapInvoiceRow(invoice),
    lineItems: (lineItems ?? []).map(mapInvoiceLineItemRow),
  });
}

/**
 * PATCH /api/v1/invoices/:id -- edits a draft manual invoice via update_manual_invoice()
 * (migration 20260101000152). Refuses (400, surfaced from the RPC's own RAISE EXCEPTION) once the
 * invoice is issued or if it isn't source='manual' at all -- financial history is never silently
 * mutated in place.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
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
      { error: { code: 'invoice_fetch_failed', message: safeErrorMessage(fetchError, 'Could not load this invoice.', 'invoices/[id].patch.fetch') } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Invoice not found.' } }, { status: 404 });
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to edit this invoice.' } },
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

  const parsed = manualInvoiceUpdateSchema.safeParse(body);
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

  const { error: rpcError } = await supabase.rpc('update_manual_invoice', {
    p_invoice_id: id,
    p_invoice_date: parsed.data.invoiceDate,
    p_due_date: parsed.data.dueDate,
    p_reference: parsed.data.reference ?? null,
    p_description: parsed.data.description ?? null,
    p_notes: parsed.data.notes ?? null,
    p_line_items: parsed.data.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
    })),
  });
  if (rpcError) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_update_failed',
          message: safeErrorMessage(
            rpcError,
            'Could not update this invoice. It may have already been issued.',
            'invoices/[id].patch',
          ),
        },
      },
      { status: 400 },
    );
  }

  const [{ data: invoice, error: invoiceError }, { data: lineItems, error: lineError }] = await Promise.all([
    supabase.from('invoices').select('*').eq('id', id).single(),
    supabase.from('invoice_line_items').select('*').eq('invoice_id', id).order('sort_order', { ascending: true }),
  ]);
  if (invoiceError || lineError) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_fetch_failed',
          message: 'Invoice was updated, but could not be reloaded. Please refresh.',
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    invoice: mapInvoiceRow(invoice),
    lineItems: (lineItems ?? []).map(mapInvoiceLineItemRow),
  });
}
