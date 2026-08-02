import { redirect, notFound } from 'next/navigation';
import { UnitForm } from '@/components/units/UnitForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

// GET /properties/:id/units/new -- TASKS.md M20 Units vertical slice, mirrors
// properties/new/page.tsx's role-gate-then-redirect pattern exactly. POST /api/v1/properties/:id/
// units re-checks agent+ server-side regardless (API_SPEC.md §11 "never only in the UI").
export default async function NewUnitPage({ params }: RouteParams) {
  const { id: propertyId } = await params;

  if (ADMIN_DEMO_MODE) {
    if (propertyId !== 'demo-property-1') notFound();
    return <UnitForm mode="create" propertyId={propertyId} />;
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');

  const supabase = await getServerSupabaseClient();
  const { data: property, error } = await supabase
    .from('properties')
    .select('id, org_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load property: ${error.message}`);
  if (!property) notFound();

  const membership = findActiveMembership(session, property.org_id);
  const canCreate = membership && membership.role !== 'viewer' && membership.role !== 'accountant';
  if (!canCreate) redirect(`/properties/${propertyId}`);

  return <UnitForm mode="create" propertyId={propertyId} />;
}
