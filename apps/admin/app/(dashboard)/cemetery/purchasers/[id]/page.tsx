import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { StatTile } from '@/components/cemetery/StatTile';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import { loadCemeteries, loadPayments, loadSites, withBalances, type PurchaserRow, type SaleRow } from '@/lib/cemetery/data';
import { BURIAL_STATUS_LABEL, PAYMENT_METHOD_LABEL, formatDate, formatZar, tenureTerms } from '@/lib/cemetery/terms';
import { UUID } from '@/lib/cemetery/http';

export const dynamic = 'force-dynamic';

/** GET /cemetery/purchasers/:id — one rights holder: contact and next of kin, linked grave sites, agreements,
 * payment history and outstanding amount. */
export default async function PurchaserPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCemeteryContext();
  if (!ctx) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await getServerSupabaseClient();
  const { data } = await supabase.from('cemetery_purchasers').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const p = data as PurchaserRow;
  const [{ data: salesData }, sites, cemeteries] = await Promise.all([
    supabase.from('cemetery_sales').select('*').eq('purchaser_id', id).order('sale_date', { ascending: false }),
    loadSites(supabase),
    loadCemeteries(supabase),
  ]);
  const sales = ((salesData ?? []) as SaleRow[]).map((s) => ({ ...s, price: Number(s.price) }));
  const payments = await loadPayments(supabase, { saleIds: sales.map((s) => s.id) });
  const balances = withBalances(sales, payments);
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const saleById = new Map(sales.map((s) => [s.id, s]));
  const reserved = sites.filter((s) => s.reserved_for_purchaser_id === id);
  const terms = tenureTerms(cemeteries[0]?.tenure_model ?? 'burial_rights');
  const active = balances.filter((s) => s.status === 'active');
  const total = (k: 'price' | 'paid' | 'balance') => active.reduce((sum, s) => sum + s[k], 0);

  return (
    <div className="space-y-5 animate-rise">
      <div>
        <Link href="/cemetery/purchasers" className="text-xs text-muted-foreground hover:underline">
          ← {terms.holders}
        </Link>
        <div className="mt-2">
          <PageHeader
            title={p.full_name}
            subtitle={`${terms.holder} · ${active.length} grave site${active.length === 1 ? '' : 's'}${reserved.length ? ` · ${reserved.length} reserved` : ''}`}
            actions={
              ctx.canManage ? (
                <Link href={`/cemetery/purchasers/${p.id}/edit`} className="flex h-9 items-center rounded-xl border border-border bg-card px-3.5 text-[13px] font-medium text-foreground">
                  Edit
                </Link>
              ) : undefined
            }
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Total agreed" value={formatZar(total('price'))} />
        <StatTile label="Paid" value={formatZar(total('paid'))} />
        <StatTile label="Outstanding" value={formatZar(total('balance'))} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Contact">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
            <Item label="Contact number" value={p.phone ?? '—'} />
            <Item label="E-mail" value={p.email ?? '—'} />
            <Item label="Address" value={p.address ?? '—'} wide />
            <Item label="Next of kin / authorised contact" value={p.next_of_kin_name ? `${p.next_of_kin_name}${p.next_of_kin_relationship ? ` (${p.next_of_kin_relationship})` : ''}` : '—'} />
            <Item label="Their contact number" value={p.next_of_kin_phone ?? '—'} />
            <Item label="Internal notes" value={p.notes ?? '—'} wide />
          </dl>
        </Panel>
        <Panel title="Linked grave sites" bodyClassName="p-0">
          {active.length === 0 && reserved.length === 0 ? (
            <p className="px-5 py-5 text-sm text-muted-foreground">No grave sites yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {active.map((s) => {
                const site = siteById.get(s.site_id);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <Link href={`/cemetery/sites/${s.site_id}`} className="font-semibold text-primary hover:underline">
                        {site?.reference ?? '—'}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {terms.sold} · {site ? BURIAL_STATUS_LABEL[site.burial_status] : ''}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        <Link href={`/cemetery/sales/${s.id}`} className="hover:underline">
                          {s.sale_number}
                        </Link>{' '}
                        · {formatDate(s.sale_date)}
                      </p>
                    </div>
                    <span className={`tabular text-right text-xs font-semibold ${s.balance > 0 ? 'text-destructive' : 'text-success'}`}>
                      {s.balance > 0 ? `${formatZar(s.balance)} due` : 'Paid'}
                    </span>
                  </li>
                );
              })}
              {reserved.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <Link href={`/cemetery/sites/${s.id}`} className="font-semibold text-primary hover:underline">
                    {s.reference}
                  </Link>
                  <span className="text-xs text-muted-foreground">Reserved{s.reserved_until ? ` until ${formatDate(s.reserved_until)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="Payment history" bodyClassName="p-0">
        {payments.length === 0 ? (
          <p className="px-5 py-5 text-sm text-muted-foreground">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-2">Receipt</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-5 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map((pay) => (
                  <tr key={pay.id}>
                    <td className="px-5 py-2">
                      <Link href={`/cemetery/receipts/${pay.id}`} className="font-medium text-primary hover:underline">
                        {pay.receipt_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{siteById.get(saleById.get(pay.sale_id)?.site_id ?? '')?.reference ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(pay.paid_on)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{PAYMENT_METHOD_LABEL[pay.method]}</td>
                    <td className="tabular px-5 py-2 text-right font-medium">{formatZar(pay.amount, { cents: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Item({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}
