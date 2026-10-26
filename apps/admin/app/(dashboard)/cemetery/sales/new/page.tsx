import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { SaleForm } from '@/components/cemetery/SaleForm';
import { DemoNotice } from '@/components/cemetery/StatTile';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import { loadCemeteries, loadPurchasers, loadSites } from '@/lib/cemetery/data';
import { tenureTerms } from '@/lib/cemetery/terms';

export const dynamic = 'force-dynamic';

type SearchParams = { searchParams: Promise<{ siteId?: string }> };

/** GET /cemetery/sales/new — the sale workflow. Only available and reserved sites are offered. */
export default async function NewCemeterySalePage({ searchParams }: SearchParams) {
  const ctx = await getCemeteryContext();
  if (!ctx || !ctx.canManage) notFound();
  const { siteId } = await searchParams;
  const supabase = await getServerSupabaseClient();
  const [cemeteries, purchasers, sites] = await Promise.all([
    loadCemeteries(supabase),
    loadPurchasers(supabase),
    loadSites(supabase, { saleStatuses: ['available', 'reserved'] }),
  ]);
  const chosen = sites.find((s) => s.id === siteId);
  const cemetery = cemeteries.find((c) => c.id === chosen?.cemetery_id) ?? cemeteries[0];
  if (!cemetery) notFound();
  const terms = tenureTerms(cemetery.tenure_model);
  const name = new Map(purchasers.map((p) => [p.id, p.full_name]));

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title={`New ${terms.saleLower}`} subtitle={`${cemetery.name} · choose a site, the ${terms.holderLower}, the price and any deposit received.`} />
      {cemetery.is_demo ? <DemoNotice /> : null}
      <SaleForm
        sites={sites
          .filter((s) => s.cemetery_id === cemetery.id)
          .map((s) => ({
            id: s.id,
            reference: s.reference,
            saleStatus: s.sale_status as 'available' | 'reserved',
            listPrice: s.list_price != null ? Number(s.list_price) : null,
            reservedForId: s.reserved_for_purchaser_id,
            reservedForName: s.reserved_for_purchaser_id ? (name.get(s.reserved_for_purchaser_id) ?? null) : null,
          }))}
        purchasers={purchasers.map((p) => ({ id: p.id, name: p.full_name }))}
        initialSiteId={chosen?.id ?? null}
        terms={terms}
        isDemo={cemetery.is_demo}
      />
    </div>
  );
}
