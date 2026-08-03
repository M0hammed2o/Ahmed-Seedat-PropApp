import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Application } from '@propvault/types';
import { APPLICATION_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapApplicationRow } from '@/lib/leasing';
import { resolvePortalSession, findActiveMembership } from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { ApplicationActions } from '@/components/applications/ApplicationActions';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

const DEMO_APPLICATION: Application = {
  id: 'demo-application-1',
  orgId: 'demo-org-1',
  propertyId: 'demo-property-1',
  unitId: 'demo-unit-1',
  applicantName: 'Sipho Nkosi',
  applicantEmail: 'sipho@example.com',
  applicantPhone: '+27 84 555 0177',
  popiaConsentAt: null,
  screeningConsentAt: null,
  screeningStatus: 'not_started',
  status: 'submitted',
  decision: null,
  decisionReason: null,
  decidedBy: null,
  decidedAt: null,
  notes: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

export default async function ApplicationDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-application-1') notFound();
    return <ApplicationDetailView application={DEMO_APPLICATION} canAct />;
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('applications').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load application: ${error.message}`);
  if (!data) notFound();
  const application = mapApplicationRow(data);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, application.orgId) : undefined;
  const canAct = Boolean(membership && membership.role !== 'viewer' && membership.role !== 'accountant');

  return <ApplicationDetailView application={application} canAct={canAct} />;
}

function ApplicationDetailView({ application, canAct }: { application: Application; canAct: boolean }) {
  return (
    <div className="space-y-6 animate-rise">
      <div>
        <Link
          href={`/properties/${application.propertyId}/units/${application.unitId}`}
          className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          ← Back to unit
        </Link>
        <div className="mt-2">
          <PageHeader
            title={application.applicantName}
            actions={<StatusBadge presentation={APPLICATION_STATUS_PRESENTATION[application.status]} />}
          />
        </div>
      </div>

      <Panel title="Applicant details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Email</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">{application.applicantEmail ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Phone</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">{application.applicantPhone ?? '—'}</dd>
          </div>
        </dl>
      </Panel>

      <ApplicationActions application={application} canAct={canAct} />
    </div>
  );
}
