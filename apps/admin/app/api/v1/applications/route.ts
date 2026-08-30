import { NextResponse, type NextRequest } from 'next/server';
import { applicationCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapApplicationRow } from '@/lib/leasing';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

/** GET/POST /api/v1/applications (API_SPEC.md §4, TASKS.md M9). Same shape as owners/tenants. */
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
  const unitIdFilter = url.searchParams.get('filter[unit_id]');

  let query = supabase
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (orgIdFilter) query = query.eq('org_id', orgIdFilter);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (unitIdFilter) query = query.eq('unit_id', unitIdFilter);
  if (cursor) query = query.or(beforeCursorFilter(cursor));

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'applications_list_failed',
          message: safeErrorMessage(error, 'Could not load applications.', 'applications.list'),
        },
      },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const applications = rows.map(mapApplicationRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;

  return NextResponse.json({ applications, next_cursor: nextCursor });
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

  const parsed = applicationCreateSchema.safeParse(body);
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
          message: 'You do not have permission to create applications for this organization.',
        },
      },
      { status: 403 },
    );
  }

  // Final local hardening pass (WORKLOG.md this date), Objective 2 P0/Step 6 finding: an archived
  // unit -- or a unit whose own property is archived (a property can be archived while its
  // vacant units stay 'vacant'; archive_property() only blocks on active leases, not on unit
  // status) -- is not available for new tenancy. Application creation has no equivalent SECURITY
  // DEFINER RPC to extend the way activate_lease() does, so the guard lives here at the route
  // layer instead. RLS-scoped read (same client the caller's own org-role check above already
  // used), never service-role -- a property hidden from this caller by RLS still 404s via the
  // normal not-found path below, this only adds a status check on a property the caller can
  // already see.
  const { data: property, error: propertyFetchError } = await supabase
    .from('properties')
    .select('status')
    .eq('id', parsed.data.propertyId)
    .maybeSingle();
  if (propertyFetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'property_fetch_failed',
          message: safeErrorMessage(
            propertyFetchError,
            'Could not load this property.',
            'applications.create.propertyFetch',
          ),
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
  if (property.status === 'archived') {
    return NextResponse.json(
      {
        error: {
          code: 'property_archived',
          message:
            'This property is archived and is not available for a new application. Restore the property first.',
        },
      },
      { status: 409 },
    );
  }

  const { data: unit, error: unitFetchError } = await supabase
    .from('units')
    .select('status')
    .eq('id', parsed.data.unitId)
    .maybeSingle();
  if (unitFetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'unit_fetch_failed',
          message: safeErrorMessage(unitFetchError, 'Could not load this unit.', 'applications.create.unitFetch'),
        },
      },
      { status: 500 },
    );
  }
  if (!unit) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Unit not found.' } },
      { status: 404 },
    );
  }
  if (unit.status === 'archived') {
    return NextResponse.json(
      {
        error: {
          code: 'unit_archived',
          message:
            'This unit is archived and is not available for a new application. Restore the unit first.',
        },
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from('applications')
    .insert({
      org_id: parsed.data.orgId,
      property_id: parsed.data.propertyId,
      unit_id: parsed.data.unitId,
      applicant_name: parsed.data.applicantName,
      applicant_email: parsed.data.applicantEmail ?? null,
      applicant_phone: parsed.data.applicantPhone ?? null,
      ...(parsed.data.selfService ? { status: 'invited' as const } : {}),
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'application_create_failed',
          message: safeErrorMessage(
            error,
            'Could not create this application. Please try again, or contact support if this continues.',
            'applications.create',
          ),
        },
      },
      { status: 500 },
    );
  }

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: parsed.data.orgId,
    actorUserId: user.id,
    actorType: 'user',
    action: 'application.created',
    entityType: 'applications',
    entityId: data.id,
    after: { unitId: parsed.data.unitId, selfService: Boolean(parsed.data.selfService) },
  });

  // Launch-hardening pass (WORKLOG.md 2026-08-26), Section 2: seeded unconditionally, not just
  // for selfService: true. Any application created through the real product UI (which never sets
  // selfService at all -- see ApplicationForm.tsx) can still be invited afterwards via the
  // now-wired "Invite applicant" action, and an invited applicant with zero seeded requirements
  // would land in the portal with nothing to upload. Best-effort: the application itself was
  // created successfully either way -- a seeding failure here shouldn't block the response.
  await supabase.rpc('seed_default_application_document_requirements', {
    p_application_id: data.id,
  });

  return NextResponse.json({ application: mapApplicationRow(data) }, { status: 201 });
}
