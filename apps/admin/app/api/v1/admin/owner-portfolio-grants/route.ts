import { NextResponse, type NextRequest } from 'next/server';
import { ownerPortfolioGrantCreateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';

/**
 * GET/POST /api/v1/admin/owner-portfolio-grants (owner subscription + staff seat entitlement
 * architecture, WORKLOG.md this date) -- super_admin only. The manual lever unlocking
 * create_organization() for a "linked owner only" account (migration 20260101000094's
 * may_create_portfolio()) until a real payment provider exists to populate this the same way.
 * Deliberately NOT implementing any charge here -- see SUBSCRIPTIONS.md and this route's own
 * BILLING PROVIDER BOUNDARY note in WORKLOG.md: a real PayFast/Apple/Google integration would
 * insert into this exact table on a successful payment webhook, not replace it.
 */
export async function GET() {
  const guard = await requireAdminRoleOrRespond('super_admin');
  if ('response' in guard) return guard.response;

  const serviceClient = getServiceRoleClient();
  const { data, error } = await serviceClient
    .from('owner_portfolio_grants')
    .select('user_id, granted_at, granted_by, note')
    .order('granted_at', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: 'grants_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    grants: (data ?? []).map((row) => ({
      userId: row.user_id,
      grantedAt: row.granted_at,
      grantedBy: row.granted_by,
      note: row.note,
    })),
  });
}

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

  const parsed = ownerPortfolioGrantCreateSchema.safeParse(body);
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
  const { data, error } = await serviceClient
    .from('owner_portfolio_grants')
    .upsert(
      {
        user_id: parsed.data.userId,
        granted_by: guard.session.authUserId,
        note: parsed.data.note ?? null,
        granted_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select('user_id, granted_at, granted_by, note')
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'grant_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId: null,
    actorUserId: guard.session.authUserId,
    actorType: 'user',
    action: 'owner_portfolio_grant.granted',
    entityType: 'owner_portfolio_grants',
    entityId: data.user_id,
    after: { note: data.note },
  });

  return NextResponse.json(
    {
      grant: {
        userId: data.user_id,
        grantedAt: data.granted_at,
        grantedBy: data.granted_by,
        note: data.note,
      },
    },
    { status: 201 },
  );
}
