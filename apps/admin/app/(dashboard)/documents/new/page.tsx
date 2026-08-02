import { redirect } from 'next/navigation';
import { DocumentUploadForm } from '@/components/documents/DocumentUploadForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export default async function NewDocumentPage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <DocumentUploadForm
        orgId="demo-org-1"
        properties={[{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }]}
        categories={[{ id: 'demo-category-1', label: 'Rental Documents' }]}
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
  const [propertiesResult, categoriesResult] = await Promise.all([
    supabase
      .from('properties')
      .select('id, nickname')
      .eq('org_id', activeOrg.orgId)
      .eq('status', 'active')
      .order('nickname', { ascending: true }),
    supabase.from('document_categories').select('id, label').eq('is_default', true).order('label', { ascending: true }),
  ]);
  if (propertiesResult.error) throw new Error(`Failed to load properties: ${propertiesResult.error.message}`);
  if (categoriesResult.error) throw new Error(`Failed to load categories: ${categoriesResult.error.message}`);

  return (
    <DocumentUploadForm orgId={activeOrg.orgId} properties={propertiesResult.data ?? []} categories={categoriesResult.data ?? []} />
  );
}
