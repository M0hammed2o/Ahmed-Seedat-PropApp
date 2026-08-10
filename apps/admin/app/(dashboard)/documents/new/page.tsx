import { redirect } from 'next/navigation';
import { DocumentUploadForm } from '@/components/documents/DocumentUploadForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type SearchParams = { searchParams: Promise<{ maintenanceTicketId?: string }> };

export default async function NewDocumentPage({ searchParams }: SearchParams) {
  const { maintenanceTicketId } = await searchParams;

  if (ADMIN_DEMO_MODE) {
    return (
      <DocumentUploadForm
        orgId="demo-org-1"
        properties={[{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }]}
        categories={[{ id: 'demo-category-1', label: 'Rental Documents' }]}
        leases={[{ id: 'demo-lease-1', label: 'Sea Point Apartment — Unit 1' }]}
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) redirect('/onboarding/create-organization');

  const membership = findActiveMembership(session, activeOrg.orgId);
  if (!membership || !canWriteOrgRecords(membership.role)) redirect('/documents');

  const supabase = await getServerSupabaseClient();

  // Security + maintenance workflow pass (WORKLOG.md this date): uploading from inside a
  // maintenance ticket already knows its own org/property/unit -- the ticket row itself is the
  // trusted source, an ordinary RLS-scoped read through the caller's own session (the same
  // has_property_access-gated policy that already protects the ticket everywhere else), never a
  // client-supplied propertyId the staff member re-picks by hand.
  if (maintenanceTicketId) {
    const { data: ticket, error: ticketError } = await supabase
      .from('maintenance_tickets')
      .select('id, org_id, property_id, unit_id, summary, properties(nickname)')
      .eq('id', maintenanceTicketId)
      .maybeSingle();
    if (ticketError) throw new Error(`Failed to load maintenance ticket: ${ticketError.message}`);
    if (ticket) {
      const { data: category, error: categoryError } = await supabase
        .from('document_categories')
        .select('id, label')
        .eq('slug', 'maintenance')
        .maybeSingle();
      if (categoryError) throw new Error(`Failed to load category: ${categoryError.message}`);

      const property = ticket.properties as unknown as { nickname: string } | null;
      return (
        <DocumentUploadForm
          orgId={ticket.org_id}
          properties={[]}
          categories={category ? [category] : []}
          leases={[]}
          lockedContext={{
            propertyId: ticket.property_id,
            propertyNickname: property?.nickname ?? 'Property',
            maintenanceTicketId: ticket.id,
            maintenanceTicketSummary: ticket.summary,
            unitId: ticket.unit_id,
          }}
        />
      );
    }
  }

  const [propertiesResult, categoriesResult, leasesResult] = await Promise.all([
    supabase
      .from('properties')
      .select('id, nickname')
      .eq('org_id', activeOrg.orgId)
      .eq('status', 'active')
      .order('nickname', { ascending: true }),
    supabase
      .from('document_categories')
      .select('id, label')
      .eq('is_default', true)
      .order('label', { ascending: true }),
    // For the optional "tag as tenant-visible" field (PWA_V1_COMPLETION_PLAN.md #10) -- lets
    // staff explicitly mark a document (e.g. the signed lease) visible to that lease's tenant(s)
    // via documents_select_tenant_self, without a blanket per-property grant.
    supabase
      .from('leases')
      .select('id, units(unit_label, properties(nickname))')
      .order('created_at', { ascending: false }),
  ]);
  if (propertiesResult.error)
    throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (categoriesResult.error)
    throw new Error(`Failed to load categories: ${categoriesResult.error.message}`);
  if (leasesResult.error) throw new Error(`Failed to load leases: ${leasesResult.error.message}`);

  const leases = (leasesResult.data ?? []).map((row) => {
    const units = row.units as unknown as {
      unit_label: string;
      properties: { nickname: string } | null;
    } | null;
    const label = units
      ? `${units.properties?.nickname ?? 'Property'} — ${units.unit_label}`
      : row.id;
    return { id: row.id as string, label };
  });

  return (
    <DocumentUploadForm
      orgId={activeOrg.orgId}
      properties={propertiesResult.data ?? []}
      categories={categoriesResult.data ?? []}
      leases={leases}
    />
  );
}
