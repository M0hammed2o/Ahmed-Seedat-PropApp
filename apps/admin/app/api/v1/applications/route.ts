import { NextResponse, type NextRequest } from 'next/server';
import { applicationCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapApplicationRow } from '@/lib/leasing';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';

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
      { error: { code: 'applications_list_failed', message: error.message } },
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
      { error: { code: 'application_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  if (parsed.data.selfService) {
    // Best-effort: the application itself was created successfully either way -- a seeding
    // failure here shouldn't block the response, since staff can still open the application and
    // the applicant-intake page tolerates zero requirements (nothing to upload yet, not an error).
    await supabase.rpc('seed_default_application_document_requirements', {
      p_application_id: data.id,
    });
  }

  return NextResponse.json({ application: mapApplicationRow(data) }, { status: 201 });
}
