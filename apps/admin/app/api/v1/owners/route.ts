import { NextResponse, type NextRequest } from 'next/server';
import { ownerCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerRow, requireOrgRole } from '@/lib/portfolio';
import { mayAddExternalOwner } from '@/lib/subscriptionEntitlements';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';

/**
 * GET/POST /api/v1/owners (API_SPEC.md §3, TASKS.md M7). Same shape as
 * apps/admin/app/api/v1/properties/route.ts: GET is a plain RLS-scoped read across every org the
 * caller belongs to (`owners_select_org_or_self`), POST validates the client-supplied `orgId`
 * against the caller's actual membership via `requireOrgRole` before the insert.
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
    .from('owners')
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
      { error: { code: 'owners_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const owners = rows.map(mapOwnerRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;

  return NextResponse.json({ owners, next_cursor: nextCursor });
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

  const parsed = ownerCreateSchema.safeParse(body);
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
          message: 'You do not have permission to add owners to this organization.',
        },
      },
      { status: 403 },
    );
  }

  // Friendlier message at the API layer, same "nicer error, real enforcement is the RLS policy"
  // split mayCreateProperty()'s own call site already establishes -- a raw PostgREST caller who
  // skips this route entirely still hits owners_insert_agent_plus_capacity (migration
  // 20260101000112), which is the actual, unbypassable enforcement.
  const withinLimit = await mayAddExternalOwner(supabase, parsed.data.orgId);
  if (!withinLimit) {
    return NextResponse.json(
      {
        error: {
          code: 'owner_limit_reached',
          message: "You've reached the external-owner allowance for your current plan.",
          upgradeRequired: true,
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('owners')
    .insert({
      org_id: parsed.data.orgId,
      owner_type: parsed.data.ownerType,
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
    })
    .select('*')
    .single();

  if (error) {
    // Defense in depth against a race (two concurrent creates both pass the pre-check above when
    // only one slot remains) -- the RLS policy is the real, unbypassable enforcement and reports a
    // generic RLS violation, not a named error like create_property()'s RPC-raised exception (no
    // dedicated owner-creation RPC exists -- see this route's own insert above), so it's mapped
    // here by Postgres error code (42501 = insufficient_privilege / RLS policy violation) rather
    // than a message-prefix match.
    if (error.code === '42501') {
      return NextResponse.json(
        {
          error: {
            code: 'owner_limit_reached',
            message: "You've reached the external-owner allowance for your current plan.",
            upgradeRequired: true,
          },
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: { code: 'owner_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ owner: mapOwnerRow(data) }, { status: 201 });
}
