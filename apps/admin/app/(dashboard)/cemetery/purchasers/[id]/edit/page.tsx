import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { PurchaserForm } from '@/components/cemetery/PurchaserForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import { loadCemeteries, type PurchaserRow } from '@/lib/cemetery/data';
import { tenureTerms } from '@/lib/cemetery/terms';
import { UUID } from '@/lib/cemetery/http';

export const dynamic = 'force-dynamic';

export default async function EditPurchaserPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCemeteryContext();
  if (!ctx || !ctx.canManage) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await getServerSupabaseClient();
  const [{ data }, cemeteries] = await Promise.all([supabase.from('cemetery_purchasers').select('*').eq('id', id).maybeSingle(), loadCemeteries(supabase)]);
  if (!data) notFound();
  const p = data as PurchaserRow;
  const terms = tenureTerms(cemeteries[0]?.tenure_model ?? 'burial_rights');
  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title={`Edit ${p.full_name}`} />
      <PurchaserForm
        mode="edit"
        purchaserId={p.id}
        holderLabel={terms.holder}
        initial={{
          fullName: p.full_name,
          phone: p.phone ?? '',
          email: p.email ?? '',
          address: p.address ?? '',
          nextOfKinName: p.next_of_kin_name ?? '',
          nextOfKinPhone: p.next_of_kin_phone ?? '',
          nextOfKinRelationship: p.next_of_kin_relationship ?? '',
          notes: p.notes ?? '',
        }}
      />
    </div>
  );
}
