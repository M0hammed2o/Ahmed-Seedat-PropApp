import { NextResponse, type NextRequest } from 'next/server';
import { planCreateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';

function mapPlanRow(row: {
  id: string;
  code: string;
  name: string;
  billing_cycle: string;
  base_price: number;
  currency: string;
  feature_limits: Record<string, number | boolean>;
  is_active: boolean;
  version: number;
  created_at: string;
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    billingCycle: row.billing_cycle,
    basePrice: row.base_price,
    currency: row.currency,
    featureLimits: row.feature_limits,
    isActive: row.is_active,
    version: row.version,
    createdAt: row.created_at,
  };
}

/** GET /api/v1/admin/plans (API_SPEC.md §2, SUPER_ADMIN.md §5) -- read_only_admin+. */
export async function GET() {
  const guard = await requireAdminRoleOrRespond('read_only_admin');
  if ('response' in guard) return guard.response;

  const serviceClient = getServiceRoleClient();
  const { data, error } = await serviceClient.from('plans').select('*').order('base_price', { ascending: true });
  if (error) {
    return NextResponse.json({ error: { code: 'plans_list_failed', message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ plans: (data ?? []).map(mapPlanRow) });
}

/**
 * POST /api/v1/admin/plans (API_SPEC.md §2, SUPER_ADMIN.md §5) -- super_admin only. Always
 * creates a NEW plan row rather than mutating an existing one -- `plans.version` (DATABASE.md §1)
 * exists specifically so a price change is a new version, and existing subscriptions keep the
 * version they signed up under unless explicitly migrated. This endpoint only ever inserts;
 * "changing" a plan's price is creating a new plan/version, not a PATCH -- consistent with
 * SUPER_ADMIN.md §5's own description of the versioning requirement.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdminRoleOrRespond('super_admin');
  if ('response' in guard) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = planCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const serviceClient = getServiceRoleClient();

  const { data: latestVersion } = await serviceClient
    .from('plans')
    .select('version')
    .eq('code', parsed.data.code)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latestVersion?.version ?? 0) + 1;

  const { data: created, error } = await serviceClient
    .from('plans')
    .insert({
      code: parsed.data.code,
      name: parsed.data.name,
      billing_cycle: parsed.data.billingCycle,
      base_price: parsed.data.basePrice,
      currency: parsed.data.currency,
      feature_limits: parsed.data.featureLimits,
      version: nextVersion,
    })
    .select('*')
    .single();
  if (error) {
    return NextResponse.json({ error: { code: 'plan_create_failed', message: error.message } }, { status: 500 });
  }

  await writeAuditEvent(serviceClient, {
    orgId: null,
    actorUserId: guard.session.authUserId,
    actorType: 'user',
    action: 'plan.create',
    entityType: 'plans',
    entityId: created.id,
    after: { code: created.code, base_price: created.base_price, version: created.version },
  });

  return NextResponse.json({ plan: mapPlanRow(created) }, { status: 201 });
}
