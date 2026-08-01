import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { updateOrganizationStatus } from '@/lib/superAdmin';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ orgId: string }> };

/** POST /api/v1/admin/organizations/:orgId/activate (API_SPEC.md §2, SUPER_ADMIN.md §4) -- support_admin+. */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('support_admin');
  if ('response' in guard) return guard.response;

  const { orgId } = await params;
  const serviceClient = getServiceRoleClient();
  try {
    const updated = await updateOrganizationStatus(serviceClient, orgId, 'active');
    if (!updated) {
      return NextResponse.json({ error: { code: 'not_found', message: 'Organization not found.' } }, { status: 404 });
    }
    await writeAuditEvent(serviceClient, {
      orgId,
      actorUserId: guard.session.authUserId,
      actorType: 'user',
      action: 'organization.activate',
      entityType: 'organizations',
      entityId: orgId,
      after: { status: 'active' },
    });
    return NextResponse.json({ organization: updated });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'organization_activate_failed', message: err instanceof Error ? err.message : 'Unknown error' } },
      { status: 500 },
    );
  }
}
