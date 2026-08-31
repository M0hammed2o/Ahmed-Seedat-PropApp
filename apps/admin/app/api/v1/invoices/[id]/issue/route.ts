import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInvoiceRow } from '@/lib/accounting';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/invoices/:id/issue -- locks a draft manual invoice and posts its AR journal entry
 * via issue_manual_invoice() (migration 20260101000152). Deliberately separate from creation/edit,
 * same "explicit action, not implicit" pattern as invoices/:id/send -- issuing NEVER emails the
 * tenant; that is still only ever POST /api/v1/invoices/:id/send.
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

  const { data: existing, error: fetchError } = await supabase
    .from('invoices')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'invoice_fetch_failed', message: safeErrorMessage(fetchError, 'Could not load this invoice.', 'invoices/[id]/issue.fetch') } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Invoice not found.' } }, { status: 404 });
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to issue this invoice.' } },
      { status: 403 },
    );
  }

  const { error: rpcError } = await supabase.rpc('issue_manual_invoice', { p_invoice_id: id });
  if (rpcError) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_issue_failed',
          message: safeErrorMessage(rpcError, 'Could not issue this invoice.', 'invoices/[id]/issue'),
        },
      },
      { status: 400 },
    );
  }

  const { data: invoice, error: reloadError } = await supabase.from('invoices').select('*').eq('id', id).single();
  if (reloadError) {
    return NextResponse.json(
      { error: { code: 'invoice_fetch_failed', message: 'Invoice was issued, but could not be reloaded. Please refresh.' } },
      { status: 500 },
    );
  }

  return NextResponse.json({ invoice: mapInvoiceRow(invoice) });
}
