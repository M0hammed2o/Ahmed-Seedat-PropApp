import { NextResponse, type NextRequest } from 'next/server';
import { renderInvoicePdf } from '@/lib/invoicePdf';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/invoices/:id/pdf -- P1 "Professional tenant invoice PDF" (final hardening pass).
 * Auth: the ordinary RLS-scoped client (invoices_select_org_member for staff,
 * invoices_select_tenant_self for the invoiced tenant themselves -- both already exist,
 * unchanged) -- a caller who cannot SELECT the row 404s here exactly as everywhere else, never a
 * separate role check that could leak existence. Generates live on every request (same
 * "nothing to expire or leak because nothing is persisted" reasoning as the subscription-invoice
 * PDF route) -- never sends the invoice; that remains solely POST /api/v1/invoices/:id/send.
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

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(
      '*, leases(unit_id, units(unit_label, properties(nickname, org_id))), tenants(full_name)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_fetch_failed',
          message: safeErrorMessage(error, 'Could not load this invoice.', 'invoices/[id]/pdf.fetch'),
        },
      },
      { status: 500 },
    );
  }
  if (!invoice) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Invoice not found.' } }, { status: 404 });
  }

  const lease = invoice.leases as unknown as {
    unit_id: string;
    units: { unit_label: string; properties: { nickname: string; org_id: string } | null } | null;
  } | null;
  const unit = lease?.units;
  const property = unit?.properties;
  const tenant = invoice.tenants as unknown as { full_name: string } | null;

  const { data: lineItemRows, error: lineError } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', id)
    .order('sort_order', { ascending: true });
  if (lineError) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_line_items_fetch_failed',
          message: safeErrorMessage(lineError, 'Could not load invoice line items.', 'invoices/[id]/pdf.lineItems'),
        },
      },
      { status: 500 },
    );
  }

  const amount = Number(invoice.amount);
  const lineItems =
    (lineItemRows ?? []).length > 0
      ? (lineItemRows ?? []).map((r) => ({
          description: r.description,
          quantity: Number(r.quantity),
          unitPrice: Number(r.unit_price),
          amount: Number(r.amount),
        }))
      : [{ description: invoice.description ?? 'Rent', quantity: 1, unitPrice: amount, amount }];

  // Snapshot (issued invoices, migration 154) is authoritative when present -- never re-read live
  // org settings for an already-issued invoice, so a later settings change can't silently alter
  // what it says. Draft invoices (previewed before issue) and pre-154 invoices with no snapshot
  // fall back to live organizations columns.
  const snapshot = invoice.presentation_snapshot as {
    orgDisplayName?: string;
    orgAddress?: string | null;
    cipcRegNo?: string | null;
    vatNo?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    paymentInstructions?: string | null;
    footer?: string | null;
  } | null;

  let org: {
    displayName: string;
    address: string | null;
    cipcRegNo: string | null;
    vatNo: string | null;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    paymentInstructions: string | null;
    footer: string | null;
  };

  if (snapshot) {
    org = {
      displayName: snapshot.orgDisplayName ?? 'Your organisation',
      address: snapshot.orgAddress ?? null,
      cipcRegNo: snapshot.cipcRegNo ?? null,
      vatNo: snapshot.vatNo ?? null,
      contactName: snapshot.contactName ?? null,
      contactPhone: snapshot.contactPhone ?? null,
      contactEmail: snapshot.contactEmail ?? null,
      paymentInstructions: snapshot.paymentInstructions ?? null,
      footer: snapshot.footer ?? null,
    };
  } else {
    const { data: orgRow, error: orgError } = await supabase
      .from('organizations')
      .select(
        'legal_name, trading_name, cipc_reg_no, vat_no, support_contact_name, support_phone, support_email, invoice_address, invoice_payment_instructions, invoice_footer',
      )
      .eq('id', invoice.org_id)
      .maybeSingle();
    if (orgError) {
      return NextResponse.json(
        {
          error: {
            code: 'organization_fetch_failed',
            message: safeErrorMessage(orgError, 'Could not load organisation details.', 'invoices/[id]/pdf.org'),
          },
        },
        { status: 500 },
      );
    }
    org = {
      displayName: orgRow?.trading_name || orgRow?.legal_name || 'Your organisation',
      address: orgRow?.invoice_address ?? null,
      cipcRegNo: orgRow?.cipc_reg_no ?? null,
      vatNo: orgRow?.vat_no ?? null,
      contactName: orgRow?.support_contact_name ?? null,
      contactPhone: orgRow?.support_phone ?? null,
      contactEmail: orgRow?.support_email ?? null,
      paymentInstructions: orgRow?.invoice_payment_instructions ?? null,
      footer: orgRow?.invoice_footer ?? null,
    };
  }

  const pdfBuffer = await renderInvoicePdf({
    invoiceNumber: invoice.invoice_number,
    status: invoice.status as 'draft' | 'issued',
    invoiceDate: invoice.created_at,
    dueDate: invoice.period,
    reference: invoice.reference,
    description: invoice.description,
    notes: invoice.notes,
    lineItems,
    amount,
    currency: 'ZAR',
    tenantName: tenant?.full_name ?? 'Unknown tenant',
    propertyNickname: property?.nickname ?? null,
    unitLabel: unit?.unit_label ?? null,
    org,
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoice.invoice_number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
