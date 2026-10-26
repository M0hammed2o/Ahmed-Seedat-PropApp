import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { PurchaserForm } from '@/components/cemetery/PurchaserForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import { loadCemeteries } from '@/lib/cemetery/data';
import { tenureTerms } from '@/lib/cemetery/terms';

export const dynamic = 'force-dynamic';

export default async function NewPurchaserPage() {
  const ctx = await getCemeteryContext();
  if (!ctx || !ctx.canManage) notFound();
  const cemeteries = await loadCemeteries(await getServerSupabaseClient());
  const terms = tenureTerms(cemeteries[0]?.tenure_model ?? 'burial_rights');
  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title={`Add ${terms.holderLower}`} subtitle="Contact details and an authorised contact / next of kin. One person can hold several grave sites." />
      <PurchaserForm mode="create" holderLabel={terms.holder} />
    </div>
  );
}
