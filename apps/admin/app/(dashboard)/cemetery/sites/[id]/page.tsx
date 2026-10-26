import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { Pill } from '@/components/ui/Pill';
import { SiteActions } from '@/components/cemetery/SiteActions';
import { DemoNotice } from '@/components/cemetery/StatTile';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import { loadPayments, loadPurchasers, withBalances, type BurialRow, type CemeteryRow, type SaleRow, type SiteDocumentRow, type SiteRow } from '@/lib/cemetery/data';
import { BURIAL_STATUS_LABEL, PAYMENT_METHOD_LABEL, SALE_STATUS_LABEL, SALE_STATUS_PILL, formatDate, formatZar, tenureTerms } from '@/lib/cemetery/terms';
import { UUID } from '@/lib/cemetery/http';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

/** GET /cemetery/sites/:id — one grave site's full record: location, status (sale and burial, separately), rights
 * holder, sale and payment history, burial register, supporting documents and internal notes. */
export default async function GraveSitePage({ params }: RouteParams) {
  const ctx = await getCemeteryContext();
  if (!ctx) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await getServerSupabaseClient();

  const { data: siteData } = await supabase.from('cemetery_sites').select('*').eq('id', id).maybeSingle();
  if (!siteData) notFound();
  const site = siteData as SiteRow;
  const [{ data: cemeteryData }, { data: section }, { data: salesData }, { data: burialsData }, { data: docsData }, purchasers] = await Promise.all([
    supabase.from('cemeteries').select('*').eq('id', site.cemetery_id).single(),
    supabase.from('cemetery_sections').select('code, name').eq('id', site.section_id).single(),
    supabase.from('cemetery_sales').select('*').eq('site_id', id).order('created_at', { ascending: false }),
    supabase.from('cemetery_burials').select('*').eq('site_id', id).order('interment_number'),
    supabase.from('cemetery_site_documents').select('*').eq('site_id', id).order('created_at', { ascending: false }),
    loadPurchasers(supabase),
  ]);
  const cemetery = cemeteryData as CemeteryRow;
  const terms = tenureTerms(cemetery.tenure_model);
  const sales = ((salesData ?? []) as SaleRow[]).map((s) => ({ ...s, price: Number(s.price) }));
  const payments = await loadPayments(supabase, { saleIds: sales.map((s) => s.id) });
  const balances = withBalances(sales, payments);
  const active = balances.find((s) => s.status === 'active') ?? null;
  const burials = (burialsData ?? []) as BurialRow[];
  const docs = (docsData ?? []) as SiteDocumentRow[];
  const purchaserById = new Map(purchasers.map((p) => [p.id, p]));
  const holder = active ? purchaserById.get(active.purchaser_id) : null;
  const reservedFor = site.reserved_for_purchaser_id ? purchaserById.get(site.reserved_for_purchaser_id) : null;
  const statusLabel = site.sale_status === 'sold' ? terms.sold : SALE_STATUS_LABEL[site.sale_status];

  return (
    <div className="space-y-5 animate-rise">
      <div>
        <Link href={`/cemetery?cemeteryId=${cemetery.id}`} className="text-xs text-muted-foreground hover:underline">
          ← {cemetery.name}
        </Link>
        <div className="mt-2">
          <PageHeader title={`Grave site ${site.reference}`} subtitle={`${section?.name ?? 'Section'} · ${site.row_label ?? '—'} · plot ${site.plot_position ?? '—'}`} />
        </div>
      </div>
      {cemetery.is_demo ? <DemoNotice /> : null}

      <div className="flex flex-wrap gap-2">
        <Pill tone={SALE_STATUS_PILL[site.sale_status]} dot>
          {statusLabel}
        </Pill>
        <Pill tone={site.burial_status === 'occupied' ? 'info' : 'neutral'} dot>
          {BURIAL_STATUS_LABEL[site.burial_status]}
          {site.max_interments > 1 ? ` · ${burials.length}/${site.max_interments}` : ''}
        </Pill>
      </div>

      {ctx.canManage ? (
        <Panel title="Actions">
          <SiteActions
            site={{
              id: site.id,
              reference: site.reference,
              saleStatus: site.sale_status,
              hasActiveSale: Boolean(active),
              activeSaleId: active?.id ?? null,
              burialsRecorded: burials.length,
              maxInterments: site.max_interments,
              listPrice: site.list_price != null ? Number(site.list_price) : null,
              lengthM: site.length_m != null ? Number(site.length_m) : null,
              widthM: site.width_m != null ? Number(site.width_m) : null,
              siteType: site.site_type,
              notes: site.notes,
            }}
            purchasers={purchasers.map((p) => ({ id: p.id, name: p.full_name }))}
            terms={terms}
          />
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Site details">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
            <Item label="Reference" value={site.reference} />
            <Item label="Cemetery / section" value={`${cemetery.name} · ${section?.code ?? ''}`} />
            <Item label="Plot location (schematic)" value={`${site.row_label ?? '—'}, plot ${site.plot_position ?? '—'}`} />
            <Item label="Dimensions" value={site.length_m && site.width_m ? `${Number(site.length_m)} m × ${Number(site.width_m)} m` : '—'} />
            <Item label="Site type" value={`${site.site_type} · ${site.max_interments} interment${site.max_interments === 1 ? '' : 's'} allowed`} />
            <Item label="List price" value={site.list_price != null ? formatZar(Number(site.list_price)) : '—'} />
            {site.sale_status === 'reserved' ? (
              <>
                <Item label="Reserved for" value={reservedFor ? reservedFor.full_name : '—'} href={reservedFor ? `/cemetery/purchasers/${reservedFor.id}` : undefined} />
                <Item label="Reserved until" value={formatDate(site.reserved_until)} />
              </>
            ) : null}
            {site.sale_status === 'unavailable' ? <Item label="Why unavailable" value={site.unavailable_reason ?? '—'} wide /> : null}
            <Item label="Internal notes" value={site.notes ?? '—'} wide />
          </dl>
        </Panel>

        <Panel title={terms.holder}>
          {active && holder ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <Item label="Name" value={holder.full_name} href={`/cemetery/purchasers/${holder.id}`} />
              <Item label="Contact number" value={holder.phone ?? '—'} />
              <Item label="E-mail" value={holder.email ?? '—'} />
              <Item label="Next of kin" value={holder.next_of_kin_name ? `${holder.next_of_kin_name}${holder.next_of_kin_relationship ? ` (${holder.next_of_kin_relationship})` : ''}` : '—'} />
              <Item label={`${terms.sale} no.`} value={active.sale_number} href={`/cemetery/sales/${active.id}`} />
              <Item label="Date" value={formatDate(active.sale_date)} />
              <Item label={terms.price} value={formatZar(active.price, { cents: true })} />
              <Item label="Deposit / paid" value={formatZar(active.paid, { cents: true })} />
              <Item label="Outstanding balance" value={formatZar(active.balance, { cents: true })} emphasis={active.balance > 0} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No {terms.holderLower} — this site has not been sold.</p>
          )}
        </Panel>
      </div>

      <Panel title="Payment history" bodyClassName="p-0">
        {payments.length === 0 ? (
          <p className="px-5 py-5 text-sm text-muted-foreground">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-2">Receipt</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-2">
                      <Link href={`/cemetery/receipts/${p.id}`} className="font-medium text-primary hover:underline">
                        {p.receipt_number}
                      </Link>
                      {p.is_deposit ? <span className="ml-2 text-[11px] text-muted-foreground">deposit</span> : null}
                      {p.is_demo ? <span className="ml-2 text-[11px] text-warning-foreground">demo</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(p.paid_on)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{PAYMENT_METHOD_LABEL[p.method]}</td>
                    <td className="tabular px-3 py-2 text-right font-medium text-foreground">{formatZar(p.amount, { cents: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Burial register">
          {burials.length === 0 ? (
            <p className="text-sm text-muted-foreground">Unused — no burial recorded.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {burials.map((b) => (
                <li key={b.id} className="rounded-lg border border-border p-3">
                  <p className="font-semibold text-foreground">
                    {b.deceased_full_name} <span className="font-normal text-muted-foreground">· interment {b.interment_number}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {b.date_of_birth ? `Born ${formatDate(b.date_of_birth)} · ` : ''}
                    {b.date_of_death ? `Died ${formatDate(b.date_of_death)} · ` : ''}Buried {formatDate(b.burial_date)}
                  </p>
                  {b.burial_order_number || b.funeral_undertaker ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {b.burial_order_number ? `Burial order ${b.burial_order_number}` : ''}
                      {b.burial_order_number && b.funeral_undertaker ? ' · ' : ''}
                      {b.funeral_undertaker ?? ''}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Supporting documents">
          <ul className="space-y-2 text-sm">
            {active ? (
              <li>
                <Link href={`/cemetery/sales/${active.id}`} className="font-medium text-primary hover:underline">
                  {terms.recordTitle} {active.sale_number}
                </Link>{' '}
                <span className="text-xs text-muted-foreground">· generated by Proplyst</span>
              </li>
            ) : null}
            {payments.map((p) => (
              <li key={p.id}>
                <Link href={`/cemetery/receipts/${p.id}`} className="font-medium text-primary hover:underline">
                  Receipt {p.receipt_number}
                </Link>{' '}
                <span className="text-xs text-muted-foreground">· generated by Proplyst</span>
              </li>
            ))}
            {docs.map((d) => (
              <li key={d.id}>
                <span className="font-medium text-foreground">{d.title}</span>{' '}
                <span className="text-xs text-muted-foreground">
                  · {d.document_type.replace(/_/g, ' ')}
                  {d.reference ? ` · ${d.reference}` : ''}
                </span>
              </li>
            ))}
            {!active && payments.length === 0 && docs.length === 0 ? <li className="text-muted-foreground">No documents.</li> : null}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Item({ label, value, href, wide, emphasis }: { label: string; value: string; href?: string; wide?: boolean; emphasis?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 ${emphasis ? 'font-semibold text-destructive' : 'text-foreground'}`}>
        {href ? (
          <Link href={href} className="text-primary hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
