import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string; unitId: string }> };
type SearchParams = { searchParams: Promise<{ tenantId?: string }> };

/**
 * GET /properties/:id/units/:unitId/leases/new (V1 launch-completion pass, Section 5): distinguish
 * "Create new lease" (the existing Prepare Lease workflow, moved unchanged to .../leases/new/prepare)
 * from "Record existing lease" (a tenancy already signed outside Proplyst, .../leases/new/existing).
 *
 * Tenant/occupancy V1 pass: an optional `?tenantId=` (set when arriving here right after Add
 * Tenant) is forwarded ONLY to "Record existing lease" -- that flow already has a tenant picker to
 * pre-select into (RecordExistingLeaseForm), matching the internal/offline-tenant workflow this
 * was built for. "Create new lease" is the digital applicant-style flow and has no equivalent
 * pre-selection concept, so it's left exactly as it was.
 */
export default async function NewLeaseChoicePage({ params, searchParams }: RouteParams & SearchParams) {
  const { id: propertyId, unitId } = await params;
  const { tenantId } = await searchParams;
  const existingHref = tenantId
    ? `/properties/${propertyId}/units/${unitId}/leases/new/existing?tenantId=${tenantId}`
    : `/properties/${propertyId}/units/${unitId}/leases/new/existing`;

  if (!ADMIN_DEMO_MODE) {
    const session = await resolvePortalSession();
    if (!session) redirect('/login');

    const supabase = await getServerSupabaseClient();
    const { data: unit, error } = await supabase
      .from('units')
      .select('id, org_id')
      .eq('id', unitId)
      .eq('property_id', propertyId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load unit: ${error.message}`);
    if (!unit) notFound();

    const membership = findActiveMembership(session, unit.org_id);
    const canCreate = membership && canWriteOrgRecords(membership.role);
    if (!canCreate) redirect(`/properties/${propertyId}/units/${unitId}`);
  }

  return (
    <div className="space-y-6 animate-rise">
      <PageHeader title="Add lease" subtitle="How do you want to add this lease?" />

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href={`/properties/${propertyId}/units/${unitId}/leases/new/prepare`}>
          <Panel bodyClassName="p-5" className="h-full transition-shadow hover:shadow-lift">
            <h3 className="font-display text-base font-semibold text-foreground">Create new lease</h3>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Start a brand-new lease for this unit — commercial terms, generate the document,
              send it to the tenant for review, and get it signed through Proplyst.
            </p>
          </Panel>
        </Link>

        <Link href={existingHref}>
          <Panel bodyClassName="p-5" className="h-full transition-shadow hover:shadow-lift">
            <h3 className="font-display text-base font-semibold text-foreground">Record existing lease</h3>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Importing an existing portfolio? Record a tenancy that was already agreed and
              signed outside Proplyst — no re-signature, no "ready for review" notice.
            </p>
          </Panel>
        </Link>
      </div>
    </div>
  );
}
