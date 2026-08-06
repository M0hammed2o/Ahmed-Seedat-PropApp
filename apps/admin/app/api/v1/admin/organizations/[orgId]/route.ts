import { NextResponse, type NextRequest } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { getPlatformOrganizationDetail } from '@/lib/superAdmin';

type RouteParams = { params: Promise<{ orgId: string }> };

/** GET /api/v1/admin/organizations/:orgId (API_SPEC.md §2, SUPER_ADMIN.md §3) -- read_only_admin+. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireAdminRoleOrRespond('read_only_admin');
  if ('response' in guard) return guard.response;

  const { orgId } = await params;
  const serviceClient = getServiceRoleClient();
  try {
    const detail = await getPlatformOrganizationDetail(serviceClient, orgId);
    if (!detail) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Organization not found.' } },
        { status: 404 },
      );
    }
    return NextResponse.json({ organization: detail });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'organization_fetch_failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      },
      { status: 500 },
    );
  }
}
