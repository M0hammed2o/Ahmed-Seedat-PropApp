import { NextResponse, type NextRequest } from 'next/server';
import { maintenanceTicketCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapMaintenanceTicketRow } from '@/lib/operations';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';

/**
 * GET/POST /api/v1/maintenance-tickets (API_SPEC.md §5, TASKS.md M13). Submitter is always staff
 * (`submitted_by_user_id`) on create -- there is no tenant portal in V1 (confirmed product
 * decision), so a client-submitted `submitted_by_tenant_id` path has no real caller yet; the
 * schema supports it (migration 20260101000034's exactly-one-submitter constraint), this route
 * just never exercises that branch.
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
  const propertyIdFilter = url.searchParams.get('filter[property_id]');

  let query = supabase
    .from('maintenance_tickets')
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
      { error: { code: 'maintenance_tickets_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const maintenanceTickets = rows.map(mapMaintenanceTicketRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

  return NextResponse.json({ maintenanceTickets, next_cursor: nextCursor });
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

  const parsed = maintenanceTicketCreateSchema.safeParse(body);
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
          message: 'You do not have permission to create maintenance tickets for this organization.',
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('maintenance_tickets')
    .insert({
      org_id: parsed.data.orgId,
      property_id: parsed.data.propertyId,
      unit_id: parsed.data.unitId ?? null,
      lease_id: parsed.data.leaseId ?? null,
      tenant_id: parsed.data.tenantId ?? null,
      submitted_by_user_id: user.id,
      summary: parsed.data.summary,
      description: parsed.data.description ?? null,
      priority: parsed.data.priority,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'maintenance_ticket_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ maintenanceTicket: mapMaintenanceTicketRow(data) }, { status: 201 });
}
