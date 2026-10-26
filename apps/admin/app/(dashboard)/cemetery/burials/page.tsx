import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { getCemeteryContext } from '@/lib/cemetery/access';
import { loadSites, type BurialRow } from '@/lib/cemetery/data';
import { formatDate } from '@/lib/cemetery/terms';

export const dynamic = 'force-dynamic';

/** GET /cemetery/burials — the burial (interment) register, newest first. */
export default async function BurialRegisterPage() {
  const ctx = await getCemeteryContext();
  if (!ctx) notFound();
  const supabase = await getServerSupabaseClient();
  const [{ data, error }, sites] = await Promise.all([
    supabase.from('cemetery_burials').select('*').order('burial_date', { ascending: false }).limit(1000),
    loadSites(supabase),
  ]);
  if (error) throw new Error(`Failed to load burials: ${error.message}`);
  const burials = (data ?? []) as BurialRow[];
  const siteRef = new Map(sites.map((s) => [s.id, s.reference]));

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Burial register" subtitle={`${burials.length} interment${burials.length === 1 ? '' : 's'} recorded. Burials are recorded from the grave site's page.`} />
      <Panel bodyClassName="p-0">
        {burials.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No burials recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5">Deceased</th>
                  <th className="px-3 py-2.5">Grave site</th>
                  <th className="px-3 py-2.5">Date of death</th>
                  <th className="px-3 py-2.5">Burial date</th>
                  <th className="px-5 py-2.5">Burial order / undertaker</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {burials.map((b) => (
                  <tr key={b.id}>
                    <td className="px-5 py-2.5 font-medium text-foreground">{b.deceased_full_name}</td>
                    <td className="px-3 py-2.5">
                      <Link href={`/cemetery/sites/${b.site_id}`} className="text-primary hover:underline">
                        {siteRef.get(b.site_id) ?? '—'}
                      </Link>
                      {b.interment_number > 1 ? <span className="ml-1 text-xs text-muted-foreground">(#{b.interment_number})</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{formatDate(b.date_of_death)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{formatDate(b.burial_date)}</td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground">{[b.burial_order_number, b.funeral_undertaker].filter(Boolean).join(' · ') || '—'}</td>
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
