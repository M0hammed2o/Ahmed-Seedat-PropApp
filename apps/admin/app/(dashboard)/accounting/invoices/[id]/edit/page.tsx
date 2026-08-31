import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { ManualInvoiceForm } from '@/components/accounting/ManualInvoiceForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /accounting/invoices/:id/edit -- overnight V1 completion pass, Part B. Draft manual
 * invoices only (update_manual_invoice() itself refuses anything else); property/unit/tenant are
 * locked in this mode, matching "must not silently mutate financial history once issued" while
 * still letting a genuine draft mistake (wrong amount, missing line, typo) be fixed before issuing.
 */
export default async function EditManualInvoicePage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) notFound();

  const supabase = await getServerSupabaseClient();
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, leases(unit_id, units(id, property_id, unit_label)), tenants(id, full_name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load invoice: ${error.message}`);
  if (!invoice) notFound();

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, invoice.org_id) : undefined;
  const canWrite = Boolean(membership && canPostAccountingRecords(membership.role));
  if (!canWrite) redirect(`/accounting/invoices/${id}`);
  if (invoice.source !== 'manual' || invoice.status !== 'draft') redirect(`/accounting/invoices/${id}`);

  const { data: lineItemRows, error: lineError } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', id)
    .order('sort_order', { ascending: true });
  if (lineError) throw new Error(`Failed to load line items: ${lineError.message}`);

  const lease = invoice.leases as unknown as {
    unit_id: string;
    units: { id: string; property_id: string; unit_label: string } | null;
  } | null;
  const tenant = invoice.tenants as unknown as { id: string; full_name: string } | null;

  return (
    <div className="space-y-6 animate-rise">
      <Link
        href={`/accounting/invoices/${id}`}
        className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        ← Back to invoice
      </Link>
      <PageHeader title="Edit invoice" subtitle={`Draft ${invoice.invoice_number}`} />
      <ManualInvoiceForm
        orgId={invoice.org_id}
        properties={[]}
        units={[]}
        tenancies={[]}
        editContext={{
          invoiceId: invoice.id,
          invoiceDate: invoice.created_at.slice(0, 10),
          dueDate: invoice.period,
          reference: invoice.reference ?? '',
          description: invoice.description ?? '',
          notes: invoice.notes ?? '',
          lineItems: (lineItemRows ?? []).map((r) => ({
            description: r.description,
            quantity: String(r.quantity),
            unitPrice: String(r.unit_price),
          })),
          propertyId: lease?.units?.property_id ?? '',
          unitId: lease?.unit_id ?? '',
          tenantId: tenant?.id ?? '',
          tenantName: tenant?.full_name ?? 'Unknown tenant',
        }}
      />
    </div>
  );
}
