import { NextResponse, type NextRequest } from 'next/server';
import { propertyCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPropertyRow, requireOrgRole } from '@/lib/portfolio';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';

/**
 * GET /api/v1/properties — list properties across every org the caller belongs to
 * (API_SPEC.md §3, TASKS.md M5). No org filter is required: RLS (`properties_select_org_member`)
 * already scopes the result to the caller's memberships, so this is a plain
 * RLS-protected read per API_SPEC.md §0's carve-out — the route exists for pagination/filtering,
 * not for enforcement.
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
  const statusFilter = url.searchParams.get('filter[status]') ?? 'active';

  let query = supabase
    .from('properties')
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
      { error: { code: 'properties_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const properties = rows.map(mapPropertyRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

  return NextResponse.json({ properties, next_cursor: nextCursor });
}

/**
 * POST /api/v1/properties — create a property in a specific org (API_SPEC.md §3, TASKS.md M5).
 * `orgId` is supplied by the client (a caller may belong to more than one org) but is never
 * trusted outright: `requireOrgRole` re-derives membership+role from the caller's own session
 * server-side before the insert, and RLS (`properties_write_agent_plus`) re-enforces the same
 * check independently at the database layer regardless of what this handler decides.
 */
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

  const parsed = propertyCreateSchema.safeParse(body);
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
          message: 'You do not have permission to add properties to this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('properties')
    .insert({
      org_id: parsed.data.orgId,
      nickname: parsed.data.nickname,
      address_line1: parsed.data.addressLine1,
      address_line2: parsed.data.addressLine2 ?? null,
      suburb: parsed.data.suburb ?? null,
      city: parsed.data.city,
      province: parsed.data.province ?? null,
      postal_code: parsed.data.postalCode ?? null,
      country: parsed.data.country,
      property_type: parsed.data.propertyType,
      municipal_account_number: parsed.data.municipalAccountNumber ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'property_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ property: mapPropertyRow(data) }, { status: 201 });
}
