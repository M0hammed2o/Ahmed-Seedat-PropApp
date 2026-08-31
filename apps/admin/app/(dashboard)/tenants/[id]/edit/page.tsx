import { redirect, notFound } from 'next/navigation';
import { TenantForm } from '@/components/tenants/TenantForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapTenantRow } from '@/lib/leasing';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

export default async function EditTenantPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-tenant-1') notFound();
    return (
      <TenantForm
        mode="edit"
        orgId="demo-org-1"
        tenant={{
          id: 'demo-tenant-1',
          orgId: 'demo-org-1',
          userId: null,
          fullName: 'Naledi Khumalo',
          email: 'naledi@example.com',
          phone: '+27 82 555 0134',
          idNumberRef: null,
          status: 'active',
          emergencyContactName: null,
          emergencyContactPhone: null,
          emergencyContactRelationship: null,
          createdAt: '2026-06-05T00:00:00Z',
          updatedAt: '2026-06-05T00:00:00Z',
        }}
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load tenant: ${error.message}`);
  if (!data) notFound();

  const tenant = mapTenantRow(data);
  const membership = findActiveMembership(session, tenant.orgId);
  const canEdit = membership && canWriteOrgRecords(membership.role);
  if (!canEdit) redirect(`/tenants/${id}`);

  return <TenantForm mode="edit" orgId={tenant.orgId} tenant={tenant} />;
}
