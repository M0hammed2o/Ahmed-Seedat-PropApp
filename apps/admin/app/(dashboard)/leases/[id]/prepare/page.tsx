import { notFound, redirect } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { PrepareLeaseClient } from './PrepareLeaseClient';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Lease preparation (Phase O, WORKLOG.md 2026-08-25). A new page rather than folding into the
 * existing lease detail page -- preparation (template pick, commercial extras, generate/upload,
 * review, send) is a distinct, multi-step workflow with its own state, not a couple of extra
 * fields on the detail view. The existing lease detail page's "Edit"/"Activate" affordances are
 * untouched; this is additive.
 */
export default async function PrepareLeasePage({ params }: RouteParams) {
  const { id } = await params;

  const session = await resolvePortalSession();
  if (!session) redirect('/login');

  const supabase = await getServerSupabaseClient();
  const { data: lease, error } = await supabase
    .from('leases')
    .select('*, units(unit_label, property_id, properties(nickname))')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load lease: ${error.message}`);
  if (!lease) notFound();

  const { units, ...leaseRow } = lease as typeof lease & {
    units: { unit_label: string; property_id: string; properties: { nickname: string } | null } | null;
  };

  const membership = findActiveMembership(session, leaseRow.org_id);
  const canEdit = Boolean(membership && canWriteOrgRecords(membership.role));
  if (!canEdit) redirect(`/leases/${id}`);

  return (
    <PrepareLeaseClient
      leaseId={id}
      orgId={leaseRow.org_id}
      leaseStatus={leaseRow.status}
      rentAmount={leaseRow.rent_amount}
      startDate={leaseRow.start_date}
      unitLabel={units?.unit_label ?? ''}
      propertyNickname={units?.properties?.nickname ?? ''}
    />
  );
}
