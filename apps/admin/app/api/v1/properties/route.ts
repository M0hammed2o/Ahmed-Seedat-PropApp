import { NextResponse, type NextRequest } from 'next/server';
import { propertyCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPropertyRow, requireOrgRole } from '@/lib/portfolio';
import { mayCreateProperty } from '@/lib/subscriptionEntitlements';
import { getGeocodingProvider } from '@/lib/providers/geocoding';
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
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;

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

  // RELEASE A P0 fix: friendlier, specific message + an `upgradeRequired` flag the UI can use to
  // render an "Upgrade plan" call to action -- the real, unbypassable enforcement is inside
  // create_property() itself (below); this pre-check exists only so the common case doesn't have
  // to round-trip a raw RPC exception message to the client. A raw PostgREST caller who skips this
  // route entirely still hits the RPC's own check (see the createError handling below).
  const withinLimit = await mayCreateProperty(supabase, parsed.data.orgId);
  if (!withinLimit) {
    return NextResponse.json(
      {
        error: {
          code: 'property_limit_reached',
          message: "You've reached the property limit for your current plan.",
          upgradeRequired: true,
        },
      },
      { status: 403 },
    );
  }

  // Property creation goes through create_property() (migration 20260101000064), not a raw
  // client insert -- properties no longer has a client-facing INSERT policy at all. A raw
  // `.insert().select().single()` here would fail RLS: the newly-inserted row's own RETURNING
  // requires the property_access grant that grant_org_members_property_access_trigger creates,
  // and that trigger's effect isn't visible in time for the SAME statement's own RETURNING check
  // (confirmed against a real local database while cutting `properties` over to
  // has_property_access() -- see the migration's own comment). The RPC sidesteps this since it
  // runs as the table owner (security definer), so its internal RETURNING never hits RLS at all;
  // this second call is an ordinary, separate SELECT, which works because the trigger's grant is
  // already committed by the time it runs.
  const { data: propertyId, error: createError } = await supabase.rpc('create_property', {
    p_org_id: parsed.data.orgId,
    p_nickname: parsed.data.nickname,
    p_address_line1: parsed.data.addressLine1,
    p_address_line2: parsed.data.addressLine2 ?? null,
    p_suburb: parsed.data.suburb ?? null,
    p_city: parsed.data.city,
    p_province: parsed.data.province ?? null,
    p_postal_code: parsed.data.postalCode ?? null,
    p_country: parsed.data.country,
    p_property_type: parsed.data.propertyType,
    p_municipal_account_number: parsed.data.municipalAccountNumber ?? null,
    p_notes: parsed.data.notes ?? null,
  });

  if (createError) {
    // Defense in depth against a race (two concurrent creates both pass the pre-check above when
    // only one slot remains) -- create_property() itself is the real, unbypassable enforcement,
    // and it raises this exact message prefix (see migration 20260101000102's own comment).
    if (createError.message.startsWith('property_limit_reached:')) {
      return NextResponse.json(
        {
          error: {
            code: 'property_limit_reached',
            message: "You've reached the property limit for your current plan.",
            upgradeRequired: true,
          },
        },
        { status: 403 },
      );
    }
    // Commercial plan restructure (20260101000117): a genuinely new self-service org that hasn't
    // completed payment-method setup can't reach this far under normal use -- the app-level
    // commercial-setup gate (destinationResolver.ts) blocks the whole dashboard first -- so this
    // only fires for a direct API call bypassing that gate, the same defense-in-depth reasoning
    // as the property-limit branch above.
    if (createError.message.startsWith('commercial_setup_required:')) {
      return NextResponse.json(
        {
          error: {
            code: 'commercial_setup_required',
            message: 'Complete payment-method setup before adding properties.',
          },
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: { code: 'property_create_failed', message: createError.message } },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'property_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  let property = mapPropertyRow(data);

  // Best-effort geocoding (2026-08-04, Owner Dashboard map) -- never blocks or fails the property
  // create itself. A geocoding failure (vendor down, address not found, no token configured yet)
  // just leaves latitude/longitude null; the property write already succeeded above.
  const coords = await getGeocodingProvider().geocode(property.fullAddress);
  if (coords) {
    const { data: geocoded, error: geocodeError } = await supabase
      .from('properties')
      .update({ latitude: coords.latitude, longitude: coords.longitude })
      .eq('id', property.id)
      .select('*')
      .single();
    if (!geocodeError && geocoded) property = mapPropertyRow(geocoded);
  }

  return NextResponse.json({ property }, { status: 201 });
}
