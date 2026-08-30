import { NextResponse, type NextRequest } from 'next/server';
import { unitSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapUnitRow, requireOrgRole } from '@/lib/portfolio';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';
import { safeErrorMessage } from '@/lib/safeError';

// Folder is named `[id]` (not `[propId]`) because Next.js requires sibling dynamic segments at
// the same path level to share one slug name — this directory is a sibling of
// app/api/v1/properties/[id]/route.ts. `id` here is the property id; renamed to `propertyId`
// below for clarity against the API_SPEC.md §3 route name (`:propId`).
type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET/POST /api/v1/properties/:propId/units (API_SPEC.md §3, TASKS.md M6). The parent property
 * lookup uses the same "SELECT through the caller's RLS-scoped client first" 404-vs-403 pattern
 * as properties/[id]/route.ts: a property in another org 404s here too, before any
 * units-specific logic runs.
 */
async function loadVisibleProperty(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  propertyId: string,
) {
  return supabase.from('properties').select('id, org_id, status').eq('id', propertyId).maybeSingle();
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: propertyId } = await params;
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

  const { data: property, error: fetchError } = await loadVisibleProperty(supabase, propertyId);
  if (fetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'property_fetch_failed',
          message: safeErrorMessage(fetchError, 'Could not load this property.', 'properties/[id]/units.fetchProperty'),
        },
      },
      { status: 500 },
    );
  }
  if (!property) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }

  const { limit, cursor } = parseListQuery(request);
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('filter[status]');

  let query = supabase
    .from('units')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (statusFilter) query = query.eq('status', statusFilter);
  if (cursor) query = query.or(beforeCursorFilter(cursor));

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'units_list_failed',
          message: safeErrorMessage(error, 'Could not load units.', 'properties/[id]/units.list'),
        },
      },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const units = rows.map(mapUnitRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;

  return NextResponse.json({ units, next_cursor: nextCursor });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: propertyId } = await params;
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

  const { data: property, error: fetchError } = await loadVisibleProperty(supabase, propertyId);
  if (fetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'property_fetch_failed',
          message: safeErrorMessage(fetchError, 'Could not load this property.', 'properties/[id]/units.fetchProperty'),
        },
      },
      { status: 500 },
    );
  }
  if (!property) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, property.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to add units to this property.',
        },
      },
      { status: 403 },
    );
  }

  // Final local hardening pass (WORKLOG.md this date), Objective 2 Step 6 finding: an archived
  // property is not an active portfolio entity -- new operational records (starting with units,
  // the root of every other new-tenancy path) must not be creatable against it. Restore the
  // property first.
  if (property.status === 'archived') {
    return NextResponse.json(
      {
        error: {
          code: 'property_archived',
          message: 'This property is archived and cannot receive new units. Restore the property first.',
        },
      },
      { status: 409 },
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

  const parsed = unitSchema.safeParse(body);
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

  const { data, error } = await supabase
    .from('units')
    .insert({
      property_id: propertyId,
      org_id: property.org_id,
      unit_label: parsed.data.unitLabel,
      bedrooms: parsed.data.bedrooms ?? null,
      bathrooms: parsed.data.bathrooms ?? null,
      size_sqm: parsed.data.sizeSqm ?? null,
      market_rent: parsed.data.marketRent ?? null,
      status: parsed.data.status ?? 'vacant',
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'unit_create_failed',
          message: safeErrorMessage(
            error,
            'Could not create this unit. Please try again, or contact support if this continues.',
            'properties/[id]/units.create',
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ unit: mapUnitRow(data) }, { status: 201 });
}
