import Link from 'next/link';
import { AlertTriangle, CheckCircle2, FileText } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolveTenantSession } from '@/lib/tenantSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

// Tenant "Required Actions" surface (PHASE 6, WORKLOG.md this date). Deliberately never blocks
// access to any other tenant-portal page -- this is a visible surface, not a hard gate (no product
// decision requires one). Scoped to the active tenancy only (session.tenantId), same as every
// other tenant-portal query.

interface RequirementRow {
  id: string;
  status: string;
  dueAt: string | null;
  acknowledgedAt: string | null;
  waivedAt: string | null;
  ruleVersion: {
    version_number: number;
    property_rules: { title: string } | null;
  } | null;
  property: { nickname: string } | null;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default async function TenantCompliancePage() {
  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader
          title="Required Actions"
          subtitle="Rules and documents that need your attention."
        />
        <Panel bodyClassName="p-0">
          <p className="px-5 py-8 text-center text-xs text-light-textMuted dark:text-dark-textMuted">
            Demo mode -- no live compliance data to show.
          </p>
        </Panel>
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();
  const session = await resolveTenantSession();
  if (!session) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Required Actions" />
        <p className="text-sm text-light-danger dark:text-dark-danger">Sign in required.</p>
      </div>
    );
  }

  const { data, error } = await supabase
    .from('compliance_requirements')
    .select(
      `id, status, due_at, acknowledged_at, waived_at,
       property_rule_versions(version_number, property_rules(title)),
       properties(nickname)`,
    )
    .eq('tenant_id', session.tenantId)
    .order('assigned_at', { ascending: false });
  if (error) throw new Error(`Failed to load compliance requirements: ${error.message}`);

  const rows: RequirementRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    status: r.status as string,
    dueAt: r.due_at as string | null,
    acknowledgedAt: r.acknowledged_at as string | null,
    waivedAt: r.waived_at as string | null,
    ruleVersion: r.property_rule_versions as unknown as RequirementRow['ruleVersion'],
    property: r.properties as unknown as RequirementRow['property'],
  }));

  const outstanding = rows.filter((r) => r.status === 'pending' || r.status === 'viewed');
  const completed = rows.filter((r) => r.status === 'acknowledged' || r.status === 'waived');

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Required Actions"
        subtitle="Rules and documents that need your attention."
      />

      <Panel title="Outstanding" bodyClassName="p-0">
        {outstanding.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-light-textMuted dark:text-dark-textMuted">
            Nothing outstanding right now.
          </p>
        ) : (
          <ul className="divide-y divide-light-border dark:divide-dark-border">
            {outstanding.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/compliance/${r.id}`}
                  className="flex items-center gap-3 px-5 py-4 hover:bg-light-surface dark:hover:bg-dark-surface"
                >
                  <AlertTriangle
                    className="h-4 w-4 shrink-0 text-light-statusOverdue dark:text-dark-statusOverdue"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-light-textPrimary dark:text-dark-textPrimary">
                      {r.ruleVersion?.property_rules?.title ?? 'Rule'} (v
                      {r.ruleVersion?.version_number})
                    </p>
                    <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
                      {r.property?.nickname ?? 'Your property'}
                      {r.dueAt ? ` · Due ${formatDate(r.dueAt)}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium text-light-accent dark:text-dark-accent">
                    Review &amp; acknowledge
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Completed" bodyClassName="p-0">
        {completed.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-light-textMuted dark:text-dark-textMuted">
            No completed items yet.
          </p>
        ) : (
          <ul className="divide-y divide-light-border dark:divide-dark-border">
            {completed.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-4">
                {r.status === 'acknowledged' ? (
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-light-statusPaid dark:text-dark-statusPaid"
                    aria-hidden="true"
                  />
                ) : (
                  <FileText
                    className="h-4 w-4 shrink-0 text-light-textMuted dark:text-dark-textMuted"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-light-textPrimary dark:text-dark-textPrimary">
                    {r.ruleVersion?.property_rules?.title ?? 'Rule'} (v
                    {r.ruleVersion?.version_number})
                  </p>
                  <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
                    {r.status === 'acknowledged'
                      ? `Acknowledged ${formatDate(r.acknowledgedAt)}`
                      : `Waived ${formatDate(r.waivedAt)}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
