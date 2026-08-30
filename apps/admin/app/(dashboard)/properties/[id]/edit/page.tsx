import { redirect, notFound } from 'next/navigation';
import { PropertyForm } from '@/components/properties/PropertyForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPropertyRow } from '@/lib/portfolio';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

// Property lifecycle pass (WORKLOG.md this date): the previously-missing edit surface for
// PATCH /api/v1/properties/[id], which already existed and already enforced RLS/property-scoped
// staff permissions -- this page only adds the UI, no new backend capability.
export default async function EditPropertyPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-property-1') notFound();
    return (
      <PropertyForm
        mode="edit"
        orgId="demo-org-1"
        property={{
          id: 'demo-property-1',
          orgId: 'demo-org-1',
          nickname: 'Sea Point Apartment',
          fullAddress: '12 Main Road, Sea Point, Cape Town, 8005',
          addressLine1: '12 Main Road',
          addressLine2: null,
          suburb: 'Sea Point',
          city: 'Cape Town',
          province: 'Western Cape',
          postalCode: '8005',
          country: 'ZA',
          propertyType: 'apartment_building',
          municipalAccountNumber: null,
          notes: null,
          status: 'active',
          imagePath: null,
          estimatedValue: null,
          estimatedValueAsOf: null,
          latitude: null,
          longitude: null,
          createdAt: '2026-06-01T00:00:00Z',
          updatedAt: '2026-06-01T00:00:00Z',
        }}
      />
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load property: ${error.message}`);
  if (!data) notFound();
  const property = mapPropertyRow(data);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, property.orgId) : undefined;
  const canEdit = Boolean(membership && canWriteOrgRecords(membership.role));
  if (!canEdit) redirect(`/properties/${id}`);

  if (!session) redirect('/login');

  return <PropertyForm mode="edit" orgId={property.orgId} property={property} />;
}
