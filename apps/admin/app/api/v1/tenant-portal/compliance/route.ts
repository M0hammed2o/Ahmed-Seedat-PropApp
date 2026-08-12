import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolveTenantSession } from '@/lib/tenantSession';

/**
 * GET /api/v1/tenant-portal/compliance -- the tenant portal's "Required Actions" + "Completed"
 * data source (PHASE 6). Scoped to the caller's currently ACTIVE tenancy only (session.tenantId),
 * matching every other tenant-portal query's active-tenancy scoping (WORKLOG.md multi-tenancy
 * pass) -- a tenant with two tenancies never sees Tenancy B's requirements while Tenancy A is
 * active. RLS (`compliance_requirements_select_tenant_self`) independently enforces that every
 * returned row is one this caller's own tenant record actually holds, regardless of this query's
 * own filter.
 */
export async function GET() {
  const supabase = await getServerSupabaseClient();
  const session = await resolveTenantSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const { data: requirements, error } = await supabase
    .from('compliance_requirements')
    .select(
      `id, status, assigned_at, due_at, viewed_at, acknowledged_at, waived_at,
       property_rule_versions(id, version_number, effective_date, acknowledgement_required, document_id,
         property_rules(id, title, category)),
       properties(nickname)`,
    )
    .eq('tenant_id', session.tenantId)
    .order('assigned_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: 'compliance_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = requirements ?? [];
  return NextResponse.json({
    outstanding: rows.filter((r) => r.status === 'pending' || r.status === 'viewed').map(mapRow),
    completed: rows.filter((r) => r.status === 'acknowledged' || r.status === 'waived').map(mapRow),
  });
}

function mapRow(r: Record<string, unknown>) {
  const ruleVersion = r.property_rule_versions as {
    id: string;
    version_number: number;
    effective_date: string;
    acknowledgement_required: boolean;
    document_id: string;
    property_rules: { id: string; title: string; category: string } | null;
  } | null;
  const property = r.properties as { nickname: string | null } | null;
  return {
    id: r.id,
    status: r.status,
    assignedAt: r.assigned_at,
    dueAt: r.due_at,
    viewedAt: r.viewed_at,
    acknowledgedAt: r.acknowledged_at,
    waivedAt: r.waived_at,
    ruleVersion: ruleVersion
      ? {
          id: ruleVersion.id,
          versionNumber: ruleVersion.version_number,
          effectiveDate: ruleVersion.effective_date,
          acknowledgementRequired: ruleVersion.acknowledgement_required,
          documentId: ruleVersion.document_id,
          rule: ruleVersion.property_rules,
        }
      : null,
    property,
  };
}
