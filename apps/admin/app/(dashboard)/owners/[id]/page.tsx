import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Owner } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerRow } from '@/lib/portfolio';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

const DEMO_OWNER: Owner = {
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
};

export default async function OwnerDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-owner-1') notFound();
    return <OwnerDetailView owner={DEMO_OWNER} canEdit />;
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('owners').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load owner: ${error.message}`);
  if (!data) notFound();
  const owner = mapOwnerRow(data);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, owner.orgId) : undefined;
  const canEdit = Boolean(membership && canWriteOrgRecords(membership.role));

  return <OwnerDetailView owner={owner} canEdit={canEdit} />;
}

function OwnerDetailView({ owner, canEdit }: { owner: Owner; canEdit: boolean }) {
  return (
    <div className="space-y-6 animate-rise">
      <div>
        <Link
          href="/owners"
          className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          ← Back to owners
        </Link>
        <div className="mt-2">
          <PageHeader
            title={owner.name}
            subtitle={owner.ownerType.charAt(0).toUpperCase() + owner.ownerType.slice(1)}
            actions={
              canEdit ? (
                <Link href={`/owners/${owner.id}/edit`}>
                  <Button variant="secondary" size="sm">
                    Edit
                  </Button>
                </Link>
              ) : undefined
            }
          />
        </div>
      </div>

      <Panel title="Owner details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Email</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {owner.email ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Phone</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {owner.phone ?? '—'}
            </dd>
          </div>
        </dl>
      </Panel>

      <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
        Property ownership shares (`POST /api/v1/properties/:id/owners`) and owner statements are
        built at the API/accounting layer (TASKS.md M7/M14) but not yet wired into this page —
        Owners is the current vertical slice.
      </p>
    </div>
  );
}
