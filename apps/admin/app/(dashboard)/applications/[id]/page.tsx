import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Application } from '@propvault/types';
import { applicationDisplayPresentation } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapApplicationRow } from '@/lib/leasing';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
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
  dateOfBirth: null,
  currentAddress: null,
  employmentStatus: null,
  employerName: null,
  monthlyIncome: null,
  householdSize: null,
  applicantNotes: null,
  submittedAt: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

export default async function ApplicationDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-application-1') notFound();
    return (
      <ApplicationDetailView
        application={DEMO_APPLICATION}
        canAct
        workflow={{ invited: true, documentsComplete: true, hasLease: false }}
        propertyName="Sea Point Apartment"
        unitLabel="Unit 1"
      />
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load application: ${error.message}`);
  if (!data) notFound();
  const application = mapApplicationRow(data);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, application.orgId) : undefined;
  const canAct = Boolean(membership && canWriteOrgRecords(membership.role));

  let propertyName: string | null = null;
  let unitLabel: string | null = null;
  if (!ADMIN_DEMO_MODE) {
    const [{ data: property }, { data: unit }] = await Promise.all([
      supabase.from('properties').select('nickname').eq('id', application.propertyId).maybeSingle(),
      supabase.from('units').select('unit_label').eq('id', application.unitId).maybeSingle(),
    ]);
    propertyName = property?.nickname ?? null;
    unitLabel = unit?.unit_label ?? null;
  }

  const workflow = ADMIN_DEMO_MODE
    ? { invited: true, documentsComplete: true, hasLease: false }
    : await loadWorkflowStageData(supabase, application.id);

  return (
    <ApplicationDetailView
      application={application}
      canAct={canAct}
      propertyName={propertyName}
      unitLabel={unitLabel}
      workflow={workflow}
    />
  );
}

interface ApplicationWorkflowData {
  invited: boolean;
  documentsComplete: boolean;
  hasLease: boolean;
}

// V1 launch-completion pass, Section 3: workflow indicator. Every signal here is a real,
// authoritative fact already queryable elsewhere in the app (access tokens, document
// requirements, leases) -- "Review" has no dedicated DB flag of its own (screening_status/
// 'reviewing' is dormant, no V1 UI path ever sets it) so it is deliberately NOT given a false
// independent signal; the indicator component below marks it complete only once Decision is,
// since a real decision cannot have happened without staff having reviewed what was submitted --
// never invented state ahead of that.
async function loadWorkflowStageData(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  applicationId: string,
): Promise<ApplicationWorkflowData> {
  const [{ count: tokenCount }, { data: requirements }, { count: leaseCount }] = await Promise.all([
    supabase
      .from('application_access_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('application_id', applicationId),
    supabase
      .from('application_document_requirements')
      .select('status, is_required')
      .eq('application_id', applicationId),
    supabase
      .from('leases')
      .select('id', { count: 'exact', head: true })
      .eq('source_application_id', applicationId),
  ]);

  const requiredRows = (requirements ?? []).filter((r) => r.is_required);
  const documentsComplete =
    requiredRows.length > 0 && requiredRows.every((r) => r.status === 'accepted' || r.status === 'reviewed');

  return {
    invited: (tokenCount ?? 0) > 0,
    documentsComplete,
    hasLease: (leaseCount ?? 0) > 0,
  };
}

// Ordered stages, each complete only from the authoritative signals above -- never inferred from
// UI navigation or optimistic client state.
function ApplicationWorkflowIndicator({
  application,
  workflow,
}: {
  application: Application;
  workflow: ApplicationWorkflowData;
}) {
  const decided = application.decidedAt !== null;
  const stages = [
    { label: 'Invitation', done: workflow.invited },
    { label: 'Applicant details', done: application.status !== 'invited' },
    { label: 'Documents', done: workflow.documentsComplete },
    { label: 'Review', done: decided },
    { label: 'Decision', done: decided },
    { label: 'Lease', done: workflow.hasLease },
  ];

  return (
    <div className="panel flex flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex items-center gap-1">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              stage.done
                ? 'bg-light-statusPaid/15 text-light-statusPaid dark:bg-dark-statusPaid/15 dark:text-dark-statusPaid'
                : 'bg-light-textMuted/10 text-light-textMuted dark:bg-dark-textMuted/10 dark:text-dark-textMuted'
            }`}
          >
            {stage.done ? '✓' : ''} {stage.label}
          </span>
          {i < stages.length - 1 ? (
            <span className="text-muted-foreground">→</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ApplicationDetailView({
  application,
  canAct,
  propertyName,
  unitLabel,
  workflow,
}: {
  application: Application;
  canAct: boolean;
  propertyName: string | null;
  unitLabel: string | null;
  workflow: ApplicationWorkflowData;
}) {
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
            actions={<StatusBadge presentation={applicationDisplayPresentation(application)} />}
          />
        </div>
      </div>

      <ApplicationWorkflowIndicator application={application} workflow={workflow} />

      <Panel title="Applicant details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Email</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {application.applicantEmail ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Phone</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {application.applicantPhone ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Property / unit</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {propertyName ?? '—'}
              {unitLabel ? ` · ${unitLabel}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Submitted</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {new Date(application.createdAt).toLocaleDateString('en-ZA')}
            </dd>
          </div>
        </dl>
      </Panel>

      <ApplicationActions application={application} canAct={canAct} />
    </div>
  );
}
