import { NextResponse, type NextRequest } from 'next/server';
import { maintenanceTicketUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapMaintenanceTicketRow, isValidMaintenanceTransition } from '@/lib/operations';

type RouteParams = { params: Promise<{ id: string }> };

async function loadVisibleTicket(supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>, id: string) {
  return supabase.from('maintenance_tickets').select('*').eq('id', id).maybeSingle();
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
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

  const { data, error } = await loadVisibleTicket(supabase, id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'maintenance_ticket_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Maintenance ticket not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ maintenanceTicket: mapMaintenanceTicketRow(data) });
}

/**
 * PATCH -- status transitions validated against the To Do -> In Progress -> Pending Approval ->
 * Completed kanban state machine (API_SPEC.md §5). RLS only expresses "agent+ in this org can
 * write this row at all"; it can't express "is this a legal transition," so that check lives here
 * (PERMISSIONS.md layer 2), same category as the invite-role/screening-consent checks elsewhere.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
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

  const { data: existing, error: fetchError } = await loadVisibleTicket(supabase, id);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'maintenance_ticket_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Maintenance ticket not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to edit this ticket.' } },
      { status: 403 },
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

  const parsed = maintenanceTicketUpdateSchema.safeParse(body);
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

  if (parsed.data.status !== undefined && !isValidMaintenanceTransition(existing.status, parsed.data.status)) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_transition',
          message: `Cannot move a ticket from '${existing.status}' to '${parsed.data.status}'.`,
        },
      },
      { status: 409 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.summary !== undefined) patch.summary = parsed.data.summary;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
  if (parsed.data.assignedVendorId !== undefined) patch.assigned_vendor_id = parsed.data.assignedVendorId;
  if (parsed.data.status !== undefined) {
    patch.status = parsed.data.status;
    if (parsed.data.status === 'completed') patch.resolved_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('maintenance_tickets')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'maintenance_ticket_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ maintenanceTicket: mapMaintenanceTicketRow(data) });
}
