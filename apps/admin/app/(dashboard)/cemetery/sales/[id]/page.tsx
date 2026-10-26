import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Panel } from '@/components/ui/Panel';
import { PaymentForm } from '@/components/cemetery/PaymentForm';
import { PrintButton } from '@/components/cemetery/PrintButton';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import { loadPayments, withBalances, type CemeteryRow, type PurchaserRow, type SaleRow, type SiteRow } from '@/lib/cemetery/data';
import { PAYMENT_METHOD_LABEL, formatDate, formatZar, tenureTerms } from '@/lib/cemetery/terms';
import { UUID } from '@/lib/cemetery/http';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> };

/** GET /cemetery/sales/:id — the sale record (printable: Grant of Right of Interment / Sale Agreement), its payment
 * history with receipts, and the record-payment form while a balance is due. */
export default async function CemeterySalePage({ params, searchParams }: Props) {
  const ctx = await getCemeteryContext();
  if (!ctx) notFound();
  const { id } = await params;
  const { created } = await searchParams;
  if (!UUID.test(id)) notFound();
  const supabase = await getServerSupabaseClient();
  const { data: saleData } = await supabase.from('cemetery_sales').select('*').eq('id', id).maybeSingle();
  if (!saleData) notFound();
  const sale0 = { ...(saleData as SaleRow), price: Number((saleData as SaleRow).price) };
  const [{ data: site }, { data: cemetery }, { data: purchaser }, { data: org }, payments] = await Promise.all([
    supabase.from('cemetery_sites').select('*').eq('id', sale0.site_id).single(),
    supabase.from('cemeteries').select('*').eq('id', sale0.cemetery_id).single(),
    supabase.from('cemetery_purchasers').select('*').eq('id', sale0.purchaser_id).single(),
    supabase.from('organizations').select('legal_name, trading_name, invoice_address').eq('id', sale0.org_id).maybeSingle(),
    loadPayments(supabase, { saleIds: [id] }),
  ]);
  const [sale] = withBalances([sale0], payments);
  const s = site as SiteRow;
  const c = cemetery as CemeteryRow;
  const p = purchaser as PurchaserRow;
  const terms = tenureTerms(sale!.tenure_model);
  const orgName = org?.trading_name || org?.legal_name || '';

  return (
    <div className="space-y-5 animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/cemetery/sites/${s.id}`} className="text-xs text-muted-foreground hover:underline">
          ← Grave site {s.reference}
        </Link>
        <PrintButton label="Print sale record" />
      </div>
      {created ? (
        <p role="status" className="rounded-xl border border-success/50 bg-success/10 px-4 py-2.5 text-sm text-foreground print:hidden">
          {terms.sale} recorded. Grave site {s.reference} is now marked <strong>{terms.sold.toLowerCase()}</strong>
          {payments.length ? <> and receipt <Link className="font-semibold text-primary underline" href={`/cemetery/receipts/${payments[payments.length - 1]!.id}`}>{payments[payments.length - 1]!.receipt_number}</Link> was issued</> : null}.
        </p>
      ) : null}

      <article className="panel space-y-6 p-6 print:border-0 print:shadow-none sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{orgName}</p>
            <h1 className="font-display text-2xl font-bold text-foreground">{terms.recordTitle}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {c.name}
              {c.city ? `, ${c.city}` : ''}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-foreground">{sale!.sale_number}</p>
            <p className="text-muted-foreground">{formatDate(sale!.sale_date)}</p>
            {sale!.is_demo ? <p className="mt-1 rounded bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-foreground">DEMONSTRATION — not a real transaction</p> : null}
          </div>
        </header>

        <div className="grid gap-6 sm:grid-cols-2">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{terms.holder}</h2>
            <p className="mt-1 font-semibold text-foreground">
              <Link href={`/cemetery/purchasers/${p.id}`} className="hover:underline">
                {p.full_name}
              </Link>
            </p>
            {p.address ? <p className="text-sm text-muted-foreground">{p.address}</p> : null}
            <p className="text-sm text-muted-foreground">{[p.phone, p.email].filter(Boolean).join(' · ')}</p>
            {p.next_of_kin_name ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Authorised contact: {p.next_of_kin_name}
                {p.next_of_kin_relationship ? ` (${p.next_of_kin_relationship})` : ''}
                {p.next_of_kin_phone ? ` · ${p.next_of_kin_phone}` : ''}
              </p>
            ) : null}
          </section>
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Grave site</h2>
            <p className="mt-1 font-semibold text-foreground">{s.reference}</p>
            <p className="text-sm text-muted-foreground">
              {s.row_label}, plot {s.plot_position}
              {s.length_m && s.width_m ? ` · ${Number(s.length_m)} m × ${Number(s.width_m)} m` : ''}
            </p>
            <p className="text-sm text-muted-foreground">
              {s.site_type} site · {s.max_interments} interment{s.max_interments === 1 ? '' : 's'}
            </p>
          </section>
        </div>

        <p className="text-sm text-foreground">
          {sale!.tenure_model === 'burial_rights'
            ? `${orgName || 'The cemetery'} grants the rights holder named above the exclusive right of interment in the grave site described${c.rights_term_years ? ` for ${c.rights_term_years} years from the date above` : ''}, subject to the cemetery's rules. Ownership of the land is not transferred.`
            : `${orgName || 'The cemetery'} sells the grave plot described above to the purchaser named, subject to the cemetery's rules.`}
        </p>

        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            <tr>
              <td className="py-2 text-muted-foreground">{terms.price}</td>
              <td className="tabular py-2 text-right font-medium text-foreground">{formatZar(sale!.price, { cents: true })}</td>
            </tr>
            {payments
              .slice()
              .reverse()
              .map((pay) => (
                <tr key={pay.id}>
                  <td className="py-2 text-muted-foreground">
                    Less: {pay.is_deposit ? 'deposit' : 'payment'} {formatDate(pay.paid_on)} ({PAYMENT_METHOD_LABEL[pay.method]}) ·{' '}
                    <Link href={`/cemetery/receipts/${pay.id}`} className="text-primary hover:underline print:no-underline">
                      {pay.receipt_number}
                    </Link>
                  </td>
                  <td className="tabular py-2 text-right text-foreground">−{formatZar(pay.amount, { cents: true })}</td>
                </tr>
              ))}
            <tr>
              <td className="py-2.5 font-semibold text-foreground">Outstanding balance</td>
              <td className={`tabular py-2.5 text-right text-lg font-bold ${sale!.balance > 0 ? 'text-destructive' : 'text-success'}`}>
                {formatZar(sale!.balance, { cents: true })}
              </td>
            </tr>
          </tbody>
        </table>
        {sale!.notes ? <p className="text-xs text-muted-foreground print:hidden">Internal notes: {sale!.notes}</p> : null}
      </article>

      {ctx.canRecordPayments && sale!.balance > 0 && sale!.status === 'active' ? (
        <Panel title="Record a payment" description={`Balance due ${formatZar(sale!.balance, { cents: true })}`} className="print:hidden">
          <PaymentForm saleId={sale!.id} balance={sale!.balance} isDemo={sale!.is_demo} />
        </Panel>
      ) : null}
    </div>
  );
}
