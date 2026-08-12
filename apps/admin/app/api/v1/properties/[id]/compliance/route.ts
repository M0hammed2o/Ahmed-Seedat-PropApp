import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/properties/:id/compliance -- the owner/staff compliance dashboard's single data
 * source (PHASE 7). Returns every compliance_requirement for the property with enough tenant/
 * unit/rule context to render "Unit 031 / Ahmed / Conduct Rules v2 -- ACKNOWLEDGED" without N+1
 * requests, plus a small summary count block. viewer+ (read-only dashboard, matches every other
 * property-detail read in this codebase).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const { data: property } = await supabase
    .from('properties')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (!property) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }
  if (!(await requireOrgRole(supabase, property.org_id, 'viewer'))) {
    return NextResponse.json(
      {
        error: { code: 'forbidden', message: 'You do not have permission to view this property.' },
      },
      { status: 403 },
    );
  }

  const statusFilter = request.nextUrl.searchParams.get('status');

  let query = supabase
    .from('compliance_requirements')
    .select(
      `id, status, assigned_at, due_at, viewed_at, acknowledged_at, waived_at, waived_reason,
       tenants(id, full_name),
       property_rule_versions(id, version_number, status, effective_date,
         property_rules(id, title, category))`,
    )
    .eq('property_id', id)
    .order('assigned_at', { ascending: false });
  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  const { data: requirements, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'compliance_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = requirements ?? [];
  const summary = {
    total: rows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    viewed: rows.filter((r) => r.status === 'viewed').length,
    acknowledged: rows.filter((r) => r.status === 'acknowledged').length,
    overdue: rows.filter(
      (r) =>
        (r.status === 'pending' || r.status === 'viewed') &&
        r.due_at &&
        r.due_at < new Date().toISOString(),
    ).length,
    waived: rows.filter((r) => r.status === 'waived').length,
  };

  return NextResponse.json({
    summary,
    // Explicitly camelCased here (not the raw Supabase snake_case join shape) -- every other
    // route in this codebase returns camelCase JSON; leaving the raw nested object would be the
    // one inconsistent response shape in the API surface.
    requirements: rows.map((r) => {
      const ruleVersion = r.property_rule_versions as unknown as {
        id: string;
        version_number: number;
        status: string;
        effective_date: string;
        property_rules: { id: string; title: string; category: string } | null;
      } | null;
      const tenant = r.tenants as unknown as { id: string; full_name: string } | null;
      return {
        id: r.id,
        status: r.status,
        assignedAt: r.assigned_at,
        dueAt: r.due_at,
        viewedAt: r.viewed_at,
        acknowledgedAt: r.acknowledged_at,
        waivedAt: r.waived_at,
        waivedReason: r.waived_reason,
        tenant: tenant ? { id: tenant.id, fullName: tenant.full_name } : null,
        ruleVersion: ruleVersion
          ? {
              id: ruleVersion.id,
              versionNumber: ruleVersion.version_number,
              status: ruleVersion.status,
              effectiveDate: ruleVersion.effective_date,
              rule: ruleVersion.property_rules,
            }
          : null,
      };
    }),
  });
}
