import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { PurchaserSearch } from '@/components/cemetery/PurchaserSearch';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import { loadCemeteries, loadPayments, loadPurchasers, loadSales, loadSites, withBalances } from '@/lib/cemetery/data';
import { tenureTerms } from '@/lib/cemetery/terms';

export const dynamic = 'force-dynamic';

/** GET /cemetery/purchasers — rights holders / purchasers with their sites and balances. Separate from Tenants: a
 * purchaser holds rights to grave sites, has no lease and no portal login. */
export default async function CemeteryPurchasersPage() {
  const ctx = await getCemeteryContext();
  if (!ctx) notFound();
  const supabase = await getServerSupabaseClient();
  const [cemeteries, purchasers, sales, sites] = await Promise.all([loadCemeteries(supabase), loadPurchasers(supabase), loadSales(supabase), loadSites(supabase)]);
  const payments = await loadPayments(supabase);
  const balances = withBalances(sales, payments).filter((s) => s.status === 'active');
  const terms = tenureTerms(cemeteries[0]?.tenure_model ?? 'burial_rights');
  const siteRef = new Map(sites.map((s) => [s.id, s.reference]));
  const reservedBy = new Map<string, string[]>();
  for (const s of sites) {
    if (s.reserved_for_purchaser_id) reservedBy.set(s.reserved_for_purchaser_id, [...(reservedBy.get(s.reserved_for_purchaser_id) ?? []), s.reference]);
  }

  const rows = purchasers.map((p) => {
    const mine = balances.filter((s) => s.purchaser_id === p.id);
    return {
      id: p.id,
      name: p.full_name,
      phone: p.phone,
      email: p.email,
      sites: mine.map((s) => siteRef.get(s.site_id) ?? '?').sort(),
      reserved: reservedBy.get(p.id) ?? [],
      paid: mine.reduce((sum, s) => sum + s.paid, 0),
      outstanding: mine.reduce((sum, s) => sum + s.balance, 0),
    };
  });

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title={terms.holders}
        subtitle={`${purchasers.length} ${terms.holders.toLowerCase()} · ${rows.filter((r) => r.outstanding > 0).length} with an outstanding balance`}
        actions={
          ctx.canManage ? (
            <Link href="/cemetery/purchasers/new" className="flex h-9 items-center rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground">
              + Add {terms.holderLower}
            </Link>
          ) : undefined
        }
      />
      <Panel bodyClassName="p-0">
        <PurchaserSearch rows={rows} holderLabel={terms.holder} />
      </Panel>
    </div>
  );
}
