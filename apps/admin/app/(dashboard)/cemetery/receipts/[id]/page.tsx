import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/cemetery/PrintButton';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import { loadPayments, withBalances, type CemeteryRow, type PaymentRow, type PurchaserRow, type SaleRow } from '@/lib/cemetery/data';
import { PAYMENT_METHOD_LABEL, formatDate, formatZar, tenureTerms } from '@/lib/cemetery/terms';
import { UUID } from '@/lib/cemetery/http';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

/** GET /cemetery/receipts/:id — printable receipt for one recorded payment, with the balance after it. */
export default async function CemeteryReceiptPage({ params }: RouteParams) {
  const ctx = await getCemeteryContext();
  if (!ctx) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await getServerSupabaseClient();
  const { data: payData } = await supabase.from('cemetery_payments').select('*').eq('id', id).maybeSingle();
  if (!payData) notFound();
  const payment = { ...(payData as PaymentRow), amount: Number((payData as PaymentRow).amount) };
  const { data: saleData } = await supabase.from('cemetery_sales').select('*').eq('id', payment.sale_id).single();
  const sale = { ...(saleData as SaleRow), price: Number((saleData as SaleRow).price) };
  const [{ data: site }, { data: cemetery }, { data: purchaser }, { data: org }, all] = await Promise.all([
    supabase.from('cemetery_sites').select('reference').eq('id', sale.site_id).single(),
    supabase.from('cemeteries').select('*').eq('id', sale.cemetery_id).single(),
    supabase.from('cemetery_purchasers').select('*').eq('id', sale.purchaser_id).single(),
    supabase.from('organizations').select('legal_name, trading_name, invoice_address, vat_no').eq('id', sale.org_id).maybeSingle(),
    loadPayments(supabase, { saleIds: [sale.id] }),
  ]);
  const c = cemetery as CemeteryRow;
  const p = purchaser as PurchaserRow;
  const terms = tenureTerms(sale.tenure_model);
  // Balance immediately after this receipt: payments up to and including it (receipt numbers are sequential).
  const upTo = all.filter((x) => x.receipt_number <= payment.receipt_number);
  const [after] = withBalances([sale], upTo);
  const orgName = org?.trading_name || org?.legal_name || '';

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/cemetery/sales/${sale.id}`} className="text-xs text-muted-foreground hover:underline">
          ← {terms.sale} {sale.sale_number}
        </Link>
        <PrintButton label="Print receipt" />
      </div>
      <article className="panel mx-auto max-w-xl space-y-5 p-6 print:border-0 print:shadow-none sm:p-8">
        <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="font-semibold text-foreground">{orgName}</p>
            <p className="text-xs text-muted-foreground">{c.name}</p>
            {org?.invoice_address ? <p className="text-xs text-muted-foreground">{org.invoice_address}</p> : null}
          </div>
          <div className="text-right">
            <h1 className="font-display text-xl font-bold text-foreground">Receipt</h1>
            <p className="text-sm font-semibold text-foreground">{payment.receipt_number}</p>
            <p className="text-xs text-muted-foreground">{formatDate(payment.paid_on)}</p>
          </div>
        </header>
        {payment.is_demo ? (
          <p className="rounded-md border border-warning bg-warning/15 px-3 py-2 text-center text-xs font-semibold text-foreground">
            DEMONSTRATION RECEIPT — fictional transaction, no money was received
          </p>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Received from</dt>
            <dd className="font-medium text-foreground">{p.full_name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">For</dt>
            <dd className="text-foreground">
              {terms.sale}, grave site {(site as { reference: string }).reference}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{terms.sale} no.</dt>
            <dd className="text-foreground">{sale.sale_number}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Method</dt>
            <dd className="text-foreground">{PAYMENT_METHOD_LABEL[payment.method]}{payment.is_deposit ? ' · deposit' : ''}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reference</dt>
            <dd className="text-foreground">{payment.reference ?? '—'}</dd>
          </div>
        </dl>
        <div className="rounded-lg bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Amount received</span>
            <span className="tabular font-display text-2xl font-bold text-foreground">{formatZar(payment.amount, { cents: true })}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">{terms.price}</span>
            <span className="tabular text-foreground">{formatZar(sale.price, { cents: true })}</span>
          </div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Total paid to date (incl. this receipt)</span>
            <span className="tabular text-foreground">{formatZar(after!.paid, { cents: true })}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between text-sm font-semibold">
            <span className="text-foreground">Balance outstanding</span>
            <span className="tabular text-foreground">{formatZar(after!.balance, { cents: true })}</span>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Issued by Proplyst for {orgName || 'the cemetery'}. This receipt records a payment the cemetery received; Proplyst does not process payments.</p>
      </article>
    </div>
  );
}
