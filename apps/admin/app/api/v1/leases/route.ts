import { NextResponse, type NextRequest } from 'next/server';
import { leaseCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapLeaseRow } from '@/lib/leasing';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';
import { safeErrorMessage } from '@/lib/safeError';

/**
 * GET/POST /api/v1/leases (API_SPEC.md §4, TASKS.md M10). POST here is the *manual* creation path
 * (`source: 'manual'`, DATABASE.md §4) -- the application-approval path creates leases via
 * approve_application() instead (apps/admin/app/api/v1/applications/[id]/decide), never through
 * this route, which is why `source`/`sourceApplicationId` are not client-settable fields on
 * leaseCreateSchema.
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
  const unitIdFilter = url.searchParams.get('filter[unit_id]');

  let query = supabase
    .from('leases')
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
          code: 'leases_list_failed',
          message: safeErrorMessage(error, 'Could not load leases.', 'leases.list'),
        },
      },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const leases = rows.map(mapLeaseRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;

  return NextResponse.json({ leases, next_cursor: nextCursor });
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

  const parsed = leaseCreateSchema.safeParse(body);
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
          message: 'You do not have permission to create leases for this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('leases')
    .insert({
      org_id: parsed.data.orgId,
      unit_id: parsed.data.unitId,
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate ?? null,
      rent_amount: parsed.data.rentAmount,
      deposit_amount: parsed.data.depositAmount,
      rent_tracking_start_date: parsed.data.rentTrackingStartDate ?? null,
      source: 'manual',
      status: 'draft',
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'lease_create_failed',
          message: safeErrorMessage(
            error,
            'Could not record this lease. Please try again, or contact support if this continues.',
            'leases.create',
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ lease: mapLeaseRow(data) }, { status: 201 });
}
