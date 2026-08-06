import { NextResponse, type NextRequest } from 'next/server';
import { tenantCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapTenantRow } from '@/lib/leasing';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';

/**
 * GET/POST /api/v1/tenants (API_SPEC.md §4, TASKS.md M8). Same shape as
 * apps/admin/app/api/v1/owners/route.ts: GET is a plain RLS-scoped read
 * (`tenants_select_org_or_self`), POST validates the client-supplied `orgId` against the
 * caller's actual membership via `requireOrgRole` before the insert.
 */
export async function GET(request: NextRequest) {
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

  const { limit, cursor } = parseListQuery(request);
  const url = new URL(request.url);
  const orgIdFilter = url.searchParams.get('filter[org_id]');
  const statusFilter = url.searchParams.get('filter[status]');

  let query = supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (orgIdFilter) query = query.eq('org_id', orgIdFilter);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (cursor) query = query.or(beforeCursorFilter(cursor));

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'tenants_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const tenants = rows.map(mapTenantRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;

  return NextResponse.json({ tenants, next_cursor: nextCursor });
}

export async function POST(request: NextRequest) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = tenantCreateSchema.safeParse(body);
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

  const canWrite = await requireOrgRole(supabase, parsed.data.orgId, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to add tenants to this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('tenants')
    .insert({
      org_id: parsed.data.orgId,
      full_name: parsed.data.fullName,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'tenant_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ tenant: mapTenantRow(data) }, { status: 201 });
}
