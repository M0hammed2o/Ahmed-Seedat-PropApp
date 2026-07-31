import { NextResponse, type NextRequest } from 'next/server';
import { vendorCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapVendorRow } from '@/lib/operations';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';

/** GET/POST /api/v1/vendors (API_SPEC.md §5, TASKS.md M13). Same shape as owners/tenants. */
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
  const statusFilter = url.searchParams.get('filter[status]') ?? 'active';

  let query = supabase
    .from('vendors')
    .select('*')
    .eq('status', statusFilter)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (orgIdFilter) query = query.eq('org_id', orgIdFilter);
  if (cursor) query = query.or(beforeCursorFilter(cursor));

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'vendors_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const vendors = rows.map(mapVendorRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

  return NextResponse.json({ vendors, next_cursor: nextCursor });
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

  const parsed = vendorCreateSchema.safeParse(body);
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
      { error: { code: 'forbidden', message: 'You do not have permission to add vendors to this organization.' } },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('vendors')
    .insert({
      org_id: parsed.data.orgId,
      name: parsed.data.name,
      trade_category: parsed.data.tradeCategory,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      is_external: parsed.data.isExternal,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'vendor_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ vendor: mapVendorRow(data) }, { status: 201 });
}
