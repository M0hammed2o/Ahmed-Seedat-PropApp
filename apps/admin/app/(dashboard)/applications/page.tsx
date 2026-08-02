import type { Application } from '@propvault/types';
import { ApplicationsTable } from '@/components/tables/ApplicationsTable';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
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
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
];

/**
 * GET /applications -- seventh module in the M20 vertical-slice sequence (TASKS.md), matching
 * PROPVIEW_SCREENSHOT_AUDIT.md's LEASING nav section. Same direct-RLS-read pattern as every other
 * list page this milestone.
 */
export default async function ApplicationsPage() {
  const applications: Application[] = ADMIN_DEMO_MODE ? DEMO_APPLICATIONS : await loadApplications();

  const submitted = applications.filter((a) => a.status === 'submitted').length;
  const screening = applications.filter((a) => a.status === 'screening').length;
  const decided = applications.filter((a) => a.status === 'decided').length;

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Applications</h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Every rental application across your portfolio. Applications are submitted from a unit.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <AdminMetricCard label="Submitted" value={submitted} />
        <AdminMetricCard label="Screening" value={screening} />
        <AdminMetricCard label="Decided" value={decided} />
      </div>

      <div className="mt-6">
        <ApplicationsTable data={applications} />
      </div>
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
