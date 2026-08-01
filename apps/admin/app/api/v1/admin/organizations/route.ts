import { NextResponse, type NextRequest } from 'next/server';
import type { OrganizationStatus } from '@propvault/types';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { requireAdminRoleOrRespond } from '@/lib/adminApiAuth';
import { listPlatformOrganizations } from '@/lib/superAdmin';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';

/** GET /api/v1/admin/organizations (API_SPEC.md §2, SUPER_ADMIN.md §3) -- read_only_admin+. */
export async function GET(request: NextRequest) {
  const guard = await requireAdminRoleOrRespond('read_only_admin');
  if ('response' in guard) return guard.response;

  const { limit, cursor } = parseListQuery(request);
  const url = new URL(request.url);
  const status = url.searchParams.get('filter[status]') as OrganizationStatus | null;
  const planCode = url.searchParams.get('filter[plan]');

  const serviceClient = getServiceRoleClient();
  try {
    const summaries = await listPlatformOrganizations(
      serviceClient,
      { status: status ?? undefined, planCode: planCode ?? undefined },
      { limit, beforeFilter: cursor ? beforeCursorFilter(cursor) : null },
    );
    const last = summaries[summaries.length - 1];
    const nextCursor =
      summaries.length === limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.orgId })
        : null;
    return NextResponse.json({ organizations: summaries, next_cursor: nextCursor });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'organizations_list_failed', message: err instanceof Error ? err.message : 'Unknown error' } },
      { status: 500 },
    );
  }
}
