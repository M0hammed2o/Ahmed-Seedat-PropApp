import type { Application } from '@propvault/types';
import { ApplicationsFilterClient } from '@/components/tables/ApplicationsFilterClient';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapApplicationRow } from '@/lib/leasing';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_APPLICATIONS: Application[] = [
  {
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
  },
];

/**
 * GET /applications -- matching PROPVIEW_SCREENSHOT_AUDIT.md's LEASING nav section. Same
 * direct-RLS-read pattern as every other list page this milestone. KPI row uses the V1-simplified
 * workflow language (New/Reviewing/Decided/Withdrawn, DECISIONS.md 2026-08-01) -- 'screening'
 * status is dormant, no V1 UI path ever sets it, so it's deliberately not counted here.
 */
export default async function ApplicationsPage() {
  const applications: Application[] = ADMIN_DEMO_MODE ? DEMO_APPLICATIONS : await loadApplications();

  const newCount = applications.filter((a) => a.status === 'submitted').length;
  const reviewing = applications.filter((a) => a.status === 'reviewing').length;
  const decided = applications.filter((a) => a.status === 'decided').length;
  const withdrawn = applications.filter((a) => a.status === 'withdrawn').length;

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Applications"
        subtitle="Every rental application across your portfolio. Applications are submitted from a unit."
      />

      <div className="grid grid-cols-4 gap-4">
        <AdminMetricCard label="New" value={newCount} />
        <AdminMetricCard label="Reviewing" value={reviewing} />
        <AdminMetricCard label="Decided" value={decided} />
        <AdminMetricCard label="Withdrawn" value={withdrawn} />
      </div>

      <ApplicationsFilterClient applications={applications} />
    </div>
  );
}

async function loadApplications(): Promise<Application[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load applications: ${error.message}`);
  return (data ?? []).map(mapApplicationRow);
}
