import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ userId: string }> };

/**
 * DELETE /api/v1/admin/owner-portfolio-grants/:userId -- revokes a previously-granted
 * owner-portfolio entitlement. Revoking this does NOT touch any organization the user has
 * already created (a real organization's own subscription status, has_org_role()'s existing
 * suspended/cancelled/archived branch, governs that separately) -- it only removes their ability
 * to create a FUTURE org while still "linked owner only" for some other property.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('super_admin');
  if ('response' in guard) return guard.response;

  const { userId } = await params;
  const serviceClient = getServiceRoleClient();

  const { data, error } = await serviceClient
    .from('owner_portfolio_grants')
    .delete()
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'grant_revoke_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      {
        error: { code: 'not_found', message: 'This user has no owner-portfolio grant to revoke.' },
      },
      { status: 404 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId: null,
    actorUserId: guard.session.authUserId,
    actorType: 'user',
    action: 'owner_portfolio_grant.revoked',
    entityType: 'owner_portfolio_grants',
    entityId: userId,
  });

  return NextResponse.json({ revoked: true });
}
