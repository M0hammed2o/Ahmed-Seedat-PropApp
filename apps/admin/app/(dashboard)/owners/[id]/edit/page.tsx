import { redirect, notFound } from 'next/navigation';
import { OwnerForm } from '@/components/owners/OwnerForm';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerRow } from '@/lib/portfolio';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

export default async function EditOwnerPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-owner-1') notFound();
    return (
      <OwnerForm
        mode="edit"
        orgId="demo-org-1"
        owner={{
          id: 'demo-owner-1',
          orgId: 'demo-org-1',
          userId: null,
          ownerType: 'individual',
          name: 'Thabo Mokoena',
          email: 'thabo@example.com',
          phone: '+27 83 555 0199',
          bankingRef: null,
          mandateStart: null,
          mandateEnd: null,
          status: 'active',
          createdAt: '2026-05-01T00:00:00Z',
          updatedAt: '2026-05-01T00:00:00Z',
        }}
      />
    );
  }

  const session = await resolvePortalSession();
  if (!session) redirect('/login');

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('owners').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load owner: ${error.message}`);
  if (!data) notFound();

  const owner = mapOwnerRow(data);
  const membership = findActiveMembership(session, owner.orgId);
  const canEdit = membership && membership.role !== 'viewer' && membership.role !== 'accountant';
  if (!canEdit) redirect(`/owners/${id}`);

  return <OwnerForm mode="edit" orgId={owner.orgId} owner={owner} />;
}
