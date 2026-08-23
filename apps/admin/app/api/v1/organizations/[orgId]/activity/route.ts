import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ orgId: string }> };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

// Organisation -> Activity (item 4, staff security + audit hardening pass, this date).
// Principal-only, matching every other staff-administration/security surface. Deliberately
// service-role after the app-layer check (same posture as
// app/api/v1/admin/organizations/[orgId]/audit/route.ts, the Super Admin equivalent this mirrors)
// rather than widening audit_events' own RLS -- audit_events_select_org_member stays at
// viewer+ unchanged (the dashboard's existing 8-row "recent activity" widget depends on it for
// every role), so this route is the actual enforcement boundary for the full, filterable,
// cross-staff view, not a second RLS policy racing the first via OR semantics.
//
// `category` filters by entity_type (not by parsing the free-form `action` string) -- entity_type
// is always the literal table/domain name, a much more stable filter surface than action strings
// that vary per verb (properties.insert / properties.update / staff.role_changed / ...).
const CATEGORY_ENTITY_TYPES: Record<string, string[]> = {
  staff: [
    'organization_members',
    'organization_invites',
    'organization_staff_provisions',
    'property_access',
  ],
  property: ['properties'],
  unit: ['units'],
  tenant: ['tenants'],
  lease: ['leases'],
  maintenance: ['maintenance_tickets'],
  inspection: ['inspections'],
  accounting: [
    'accounting_periods',
    'expenses',
    'journal_entries',
    'cash_receipts',
    'owner_statements',
    'payment_reports',
    'levy_statements',
  ],
  document: ['extraction_jobs', 'extraction_results', 'documents'],
  billing: ['subscription_payments', 'organization_subscriptions', 'billing_plan_changes'],
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
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

  const isPrincipal = await requireOrgRole(supabase, orgId, 'principal');
  if (!isPrincipal) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Only the organization principal can view the organisation activity log.',
        },
      },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const actorUserId = url.searchParams.get('actorUserId');
  const category = url.searchParams.get('category');
  const propertyId = url.searchParams.get('propertyId');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const search = url.searchParams.get('search')?.trim();
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT);

  const serviceClient = getServiceRoleClient();
  let query = serviceClient
    .from('audit_events')
    .select(
      'id, actor_user_id, actor_type, action, entity_type, entity_id, before, after, property_id, actor_role, actor_display_name, created_at',
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (actorUserId) query = query.eq('actor_user_id', actorUserId);
  if (category && CATEGORY_ENTITY_TYPES[category]) {
    query = query.in('entity_type', CATEGORY_ENTITY_TYPES[category]);
  }
  if (propertyId) query = query.eq('property_id', propertyId);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (cursor) query = query.lt('created_at', cursor);
  if (search) query = query.or(`action.ilike.%${search}%,actor_display_name.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'activity_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = data ?? [];

  // Snapshot fallback: rows written before this pass (or whose actor had no resolvable snapshot
  // at write time) may have a null actor_display_name -- resolve those specific actors' CURRENT
  // name as a best-effort fallback rather than showing nothing. This is read-time convenience
  // only; it never rewrites the stored snapshot (audit_events is append-only).
  const missingNameActorIds = [
    ...new Set(
      rows.filter((r) => r.actor_user_id && !r.actor_display_name).map((r) => r.actor_user_id as string),
    ),
  ];
  const fallbackNameById = new Map<string, string>();
  if (missingNameActorIds.length > 0) {
    const { data: profiles } = await serviceClient
      .from('profiles')
      .select('id, display_name')
      .in('id', missingNameActorIds);
    for (const p of profiles ?? []) {
      if (p.display_name) fallbackNameById.set(p.id, p.display_name);
    }
  }

  const activity = rows.map((row) => ({
    id: row.id,
    actorUserId: row.actor_user_id,
    actorType: row.actor_type,
    actorRole: row.actor_role,
    actorDisplayName:
      row.actor_display_name ??
      (row.actor_user_id ? (fallbackNameById.get(row.actor_user_id) ?? null) : null),
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    before: row.before,
    after: row.after,
    propertyId: row.property_id,
    createdAt: row.created_at,
  }));

  const nextCursor =
    rows.length === limit ? (rows[rows.length - 1]?.created_at ?? null) : null;

  return NextResponse.json({ activity, nextCursor });
}
