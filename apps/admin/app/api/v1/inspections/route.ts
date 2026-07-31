import { NextResponse, type NextRequest } from 'next/server';
import { inspectionCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInspectionRow } from '@/lib/operations';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';

/** GET/POST /api/v1/inspections (API_SPEC.md §5, TASKS.md M13). */
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
  const propertyIdFilter = url.searchParams.get('filter[property_id]');

  // Ordered/paginated by created_at, matching beforeCursorFilter's assumption (same convention as
  // every other list endpoint) -- scheduled_at is exposed as a filterable/sortable field client-
  // side once a real Web UI reads this, not as this endpoint's own cursor ordering.
  let query = supabase
    .from('inspections')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (orgIdFilter) query = query.eq('org_id', orgIdFilter);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (propertyIdFilter) query = query.eq('property_id', propertyIdFilter);
  if (cursor) query = query.or(beforeCursorFilter(cursor));

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'inspections_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const inspections = rows.map(mapInspectionRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

  return NextResponse.json({ inspections, next_cursor: nextCursor });
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

  const parsed = inspectionCreateSchema.safeParse(body);
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
          message: 'You do not have permission to schedule inspections for this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('inspections')
    .insert({
      org_id: parsed.data.orgId,
      property_id: parsed.data.propertyId,
      unit_id: parsed.data.unitId,
      lease_id: parsed.data.leaseId ?? null,
      inspection_type: parsed.data.inspectionType,
      scheduled_at: parsed.data.scheduledAt,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'inspection_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ inspection: mapInspectionRow(data) }, { status: 201 });
}
