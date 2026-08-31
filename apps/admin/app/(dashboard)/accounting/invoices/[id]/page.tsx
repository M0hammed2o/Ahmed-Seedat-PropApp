import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { formatSouthAfricanNumber } from '@propvault/utils';
import {
  IssueInvoiceButton,
  SendInvoiceButton,
  RecordPaymentForm,
  PrintButton,
} from '@/components/accounting/InvoiceActions';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

function currency(n: number): string {
  return `R${formatSouthAfricanNumber(n)}`;
}
function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * GET /accounting/invoices/:id -- overnight V1 completion pass, Part B. Manual invoices (draft or
 * issued) get the full BILL TO / line-items / issue / payments view built for this pass;
 * rent-schedule invoices (source='rent_schedule', from invoice_rent_schedule()) show the same page
 * with a single synthesized line item (they have no real invoice_line_items rows -- by design,
 * that RPC is untouched) and no issue/edit actions, since they're already issued the moment they
 * exist. Print uses the browser's own print dialog ("Save as PDF") -- a dedicated pdfkit renderer
 * mirroring subscriptionInvoicePdf.ts is a reasonable fast-follow, reported separately rather than
 * built here under time pressure.
 */
export default async function InvoiceDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-invoice-1') notFound();
    return (
      <InvoiceDetailView
        invoice={{
          id: 'demo-invoice-1',
          invoiceNumber: 'INV-000123',
          status: 'issued',
          source: 'rent_schedule',
          period: '2026-09-01',
          issuedAt: '2026-08-25T00:00:00Z',
          amount: 12500,
          description: null,
          notes: null,
          reference: null,
          emailedAt: null,
        }}
        tenant={{ id: 'demo-tenant-1', fullName: 'Naledi Khumalo', email: 'naledi@example.com' }}
        property={{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }}
        unit={{ id: 'demo-unit-1', unitLabel: 'Unit 1' }}
        org={{ legalName: 'Demo Property Group', vatNo: null }}
        lineItems={[]}
        payments={[]}
        canWrite
      />
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, leases(unit_id, units(id, unit_label, properties(id, nickname, org_id))), tenants(id, full_name, email)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load invoice: ${error.message}`);
  if (!invoice) notFound();

  const lease = invoice.leases as unknown as {
    unit_id: string;
    units: { id: string; unit_label: string; properties: { id: string; nickname: string; org_id: string } | null } | null;
  } | null;
  const unit = lease?.units;
  const property = unit?.properties;
  const tenant = invoice.tenants as unknown as { id: string; full_name: string; email: string | null } | null;

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, invoice.org_id) : undefined;
  const canWrite = Boolean(membership && canPostAccountingRecords(membership.role));
  if (!membership) redirect('/accounting/invoices');

  const { data: org } = await supabase
    .from('organizations')
    .select('legal_name, trading_name, vat_no')
    .eq('id', invoice.org_id)
    .maybeSingle();

  const [{ data: lineItemRows }, { data: paymentRows }] = await Promise.all([
    supabase.from('invoice_line_items').select('*').eq('invoice_id', id).order('sort_order', { ascending: true }),
    invoice.status === 'issued'
      ? supabase.from('invoice_payments').select('*').eq('invoice_id', id).order('paid_at', { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
  ]);

  return (
    <InvoiceDetailView
      invoice={{
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        status: invoice.status,
        source: invoice.source,
        period: invoice.period,
        issuedAt: invoice.issued_at,
        amount: Number(invoice.amount),
        description: invoice.description,
        notes: invoice.notes,
        reference: invoice.reference,
        emailedAt: invoice.emailed_at,
      }}
      tenant={tenant ? { id: tenant.id, fullName: tenant.full_name, email: tenant.email } : null}
      property={property ? { id: property.id, nickname: property.nickname } : null}
      unit={unit ? { id: unit.id, unitLabel: unit.unit_label } : null}
      org={{ legalName: org?.trading_name || org?.legal_name || 'Your organisation', vatNo: org?.vat_no ?? null }}
      lineItems={(lineItemRows ?? []).map((r) => ({
        id: r.id,
        description: r.description,
        quantity: Number(r.quantity),
        unitPrice: Number(r.unit_price),
        amount: Number(r.amount),
      }))}
      payments={(paymentRows ?? []).map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        paidAt: r.paid_at,
        method: r.method,
      }))}
      canWrite={canWrite}
    />
  );
}

function InvoiceDetailView({
  invoice,
  tenant,
  property,
  unit,
  org,
  lineItems,
  payments,
  canWrite,
}: {
  invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    source: string;
    period: string;
    issuedAt: string | null;
    amount: number;
    description: string | null;
    notes: string | null;
    reference: string | null;
    emailedAt: string | null;
  };
  tenant: { id: string; fullName: string; email: string | null } | null;
  property: { id: string; nickname: string } | null;
  unit: { id: string; unitLabel: string } | null;
  org: { legalName: string; vatNo: string | null };
  lineItems: { id: string; description: string; quantity: number; unitPrice: number; amount: number }[];
  payments: { id: string; amount: number; paidAt: string; method: string | null }[];
  canWrite: boolean;
}) {
  const isManual = invoice.source === 'manual';
  const isDraft = invoice.status === 'draft';
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const balance = Math.max(0, invoice.amount - paid);

  const displayLines =
    lineItems.length > 0
      ? lineItems
      : [{ id: 'virtual', description: invoice.description ?? 'Rent', quantity: 1, unitPrice: invoice.amount, amount: invoice.amount }];

  return (
    <div className="space-y-6 animate-rise print:space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/accounting/invoices" className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary">
          ← All invoices
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/v1/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener noreferrer">
            <Button size="sm">Download PDF</Button>
          </a>
          <PrintButton />
          {canWrite && isManual && isDraft ? (
            <Link href={`/accounting/invoices/${invoice.id}/edit`}>
              <Button size="sm">Edit</Button>
            </Link>
          ) : null}
          {canWrite && isManual && isDraft ? <IssueInvoiceButton invoiceId={invoice.id} /> : null}
          {canWrite && invoice.status === 'issued' ? <SendInvoiceButton invoiceId={invoice.id} /> : null}
        </div>
      </div>

      <PageHeader title={`Invoice ${invoice.invoiceNumber}`} subtitle={isDraft ? 'Draft -- not yet issued' : `Issued ${invoice.issuedAt ? longDate(invoice.issuedAt) : ''}`} />

      <Panel bodyClassName="p-6">
        <div className="flex flex-wrap justify-between gap-6 border-b border-light-border pb-4 dark:border-dark-border">
          <div>
            <p className="text-xs uppercase tracking-wide text-light-textMuted dark:text-dark-textMuted">From</p>
            <p className="mt-1 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">{org.legalName}</p>
            {org.vatNo ? <p className="text-xs text-light-textMuted dark:text-dark-textMuted">VAT: {org.vatNo}</p> : null}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-light-textMuted dark:text-dark-textMuted">Bill to</p>
            <p className="mt-1 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              {tenant ? (
                <Link href={`/tenants/${tenant.id}`} className="hover:underline print:no-underline">
                  {tenant.fullName}
                </Link>
              ) : (
                'Unknown tenant'
              )}
            </p>
            <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
              {[property?.nickname, unit?.unitLabel].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-light-textMuted dark:text-dark-textMuted">Details</p>
            <p className="mt-1 text-xs text-light-textPrimary dark:text-dark-textPrimary">Due: {longDate(invoice.period)}</p>
            {invoice.reference ? (
              <p className="text-xs text-light-textMuted dark:text-dark-textMuted">Ref: {invoice.reference}</p>
            ) : null}
          </div>
        </div>

        {invoice.description ? (
          <p className="mt-4 text-sm text-light-textPrimary dark:text-dark-textPrimary">{invoice.description}</p>
        ) : null}

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-light-border text-left text-xs text-light-textMuted dark:border-dark-border dark:text-dark-textMuted">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Rate</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {displayLines.map((l) => (
              <tr key={l.id} className="border-b border-light-border/60 dark:border-dark-border/60">
                <td className="py-2 text-light-textPrimary dark:text-dark-textPrimary">{l.description}</td>
                <td className="tabular py-2 text-right text-light-textPrimary dark:text-dark-textPrimary">{l.quantity}</td>
                <td className="tabular py-2 text-right text-light-textPrimary dark:text-dark-textPrimary">{currency(l.unitPrice)}</td>
                <td className="tabular py-2 text-right text-light-textPrimary dark:text-dark-textPrimary">{currency(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <div className="w-56 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-light-textMuted dark:text-dark-textMuted">Total</span>
              <span className="tabular font-semibold text-light-textPrimary dark:text-dark-textPrimary">{currency(invoice.amount)}</span>
            </div>
            {invoice.status === 'issued' ? (
              <>
                <div className="flex justify-between">
                  <span className="text-light-textMuted dark:text-dark-textMuted">Paid</span>
                  <span className="tabular text-light-textPrimary dark:text-dark-textPrimary">{currency(paid)}</span>
                </div>
                <div className="flex justify-between border-t border-light-border pt-1 dark:border-dark-border">
                  <span className="font-medium text-light-textPrimary dark:text-dark-textPrimary">Balance</span>
                  <span className="tabular font-semibold text-light-textPrimary dark:text-dark-textPrimary">{currency(balance)}</span>
                </div>
              </>
            ) : null}
          </div>
        </div>

        {invoice.notes ? (
          <p className="mt-4 border-t border-light-border pt-3 text-xs text-light-textMuted dark:border-dark-border dark:text-dark-textMuted">
            {invoice.notes}
          </p>
        ) : null}
      </Panel>

      {isManual && invoice.status === 'issued' ? (
        <Panel title="Payments" bodyClassName="p-4" className="print:hidden">
          {payments.length === 0 ? (
            <p className="px-1 py-1 text-[13px] text-light-textMuted dark:text-dark-textMuted">No payments recorded yet.</p>
          ) : (
            <ul className="mb-3 divide-y divide-light-border dark:divide-dark-border">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-1 py-2 text-[13px]">
                  <span className="text-light-textPrimary dark:text-dark-textPrimary">
                    {longDate(p.paidAt)}
                    {p.method ? ` · ${p.method}` : ''}
                  </span>
                  <span className="tabular font-medium text-light-textPrimary dark:text-dark-textPrimary">{currency(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {canWrite && balance > 0 ? <RecordPaymentForm invoiceId={invoice.id} /> : null}
        </Panel>
      ) : null}
    </div>
  );
}
