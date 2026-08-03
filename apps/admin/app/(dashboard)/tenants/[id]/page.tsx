import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Tenant } from '@propvault/types';
import { TENANT_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapTenantRow } from '@/lib/leasing';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

const DEMO_TENANT: Tenant = {
  id: 'demo-tenant-1',
  orgId: 'demo-org-1',
  userId: null,
  fullName: 'Naledi Khumalo',
  email: 'naledi@example.com',
  phone: '+27 82 555 0134',
  idNumberRef: null,
  status: 'active',
  createdAt: '2026-06-05T00:00:00Z',
  updatedAt: '2026-06-05T00:00:00Z',
};

export default async function TenantDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-tenant-1') notFound();
    return <TenantDetailView tenant={DEMO_TENANT} canEdit />;
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load tenant: ${error.message}`);
  if (!data) notFound();
  const tenant = mapTenantRow(data);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, tenant.orgId) : undefined;
  const canEdit = Boolean(membership && membership.role !== 'viewer' && membership.role !== 'accountant');

  return <TenantDetailView tenant={tenant} canEdit={canEdit} />;
}

function TenantDetailView({ tenant, canEdit }: { tenant: Tenant; canEdit: boolean }) {
  return (
    <div className="space-y-6 animate-rise">
      <div>
        <Link
          href="/tenants"
          className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          ← Back to tenants
        </Link>
        <div className="mt-2">
          <PageHeader
            title={tenant.fullName}
            actions={
              canEdit ? (
                <Link href={`/tenants/${tenant.id}/edit`}>
                  <Button variant="secondary" size="sm">
                    Edit
                  </Button>
                </Link>
              ) : undefined
            }
          />
        </div>
        <div className="mt-1">
          <StatusBadge presentation={TENANT_STATUS_PRESENTATION[tenant.status]} />
        </div>
      </div>

      <Panel title="Tenant details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Email</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">{tenant.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Phone</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">{tenant.phone ?? '—'}</dd>
          </div>
        </dl>
      </Panel>

      <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
        Leases and maintenance history for this tenant are built at the API layer (TASKS.md
        M10/M13) but not yet wired into this page — Tenants is the current vertical slice, Leases
        is next.
      </p>
    </div>
  );
}
