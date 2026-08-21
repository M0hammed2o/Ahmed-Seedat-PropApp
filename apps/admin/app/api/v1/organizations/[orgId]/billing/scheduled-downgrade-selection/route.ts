import { NextResponse, type NextRequest } from 'next/server';
import { scheduledDowngradeSelectionSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireBillingPrincipalAccess } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ orgId: string }> };

/**
 * POST /api/v1/organizations/:orgId/billing/scheduled-downgrade-selection -- V1 commercial UX
 * pass. Lets the principal set/replace which resources stay active for their OWN already-scheduled
 * (non-trial) downgrade, any time before it takes effect at current_period_end --
 * set_scheduled_downgrade_selection() (migration 20260101000121) is the actual authority; this
 * route just validates the request shape and surfaces its result/errors.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  const isPrincipal = await requireBillingPrincipalAccess(supabase, orgId);
  if (!isPrincipal) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Only the organization principal can manage billing.',
        },
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = scheduledDowngradeSelectionSchema.safeParse(body);
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

  const { data, error } = await supabase
    .rpc('set_scheduled_downgrade_selection', {
      p_org_id: orgId,
      p_keep_property_ids: parsed.data.keepPropertyIds ?? null,
      p_keep_owner_ids: parsed.data.keepOwnerIds ?? null,
      p_keep_staff_member_ids: parsed.data.keepStaffMemberIds ?? null,
    })
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'scheduled_downgrade_selection_failed', message: error.message } },
      { status: 422 },
    );
  }

  const row = data as {
    id: string;
    keep_property_ids: string[] | null;
    keep_owner_ids: string[] | null;
    keep_staff_member_ids: string[] | null;
    effective_at: string;
  };

  return NextResponse.json({
    billingPlanChangeId: row.id,
    keepPropertyIds: row.keep_property_ids,
    keepOwnerIds: row.keep_owner_ids,
    keepStaffMemberIds: row.keep_staff_member_ids,
    effectiveAt: row.effective_at,
  });
}
