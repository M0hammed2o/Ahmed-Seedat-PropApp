import { NextResponse, type NextRequest } from 'next/server';
import { maintenanceTicketUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapMaintenanceTicketRow, isValidMaintenanceTransition } from '@/lib/operations';
import { dispatchEmail } from '@/lib/emailDispatch';
import { dispatchWhatsApp } from '@/lib/whatsappDispatch';

type RouteParams = { params: Promise<{ id: string }> };

async function loadVisibleTicket(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  id: string,
) {
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

  if (
    parsed.data.status !== undefined &&
    !isValidMaintenanceTransition(existing.status, parsed.data.status)
  ) {
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
  if (parsed.data.assignedVendorId !== undefined)
    patch.assigned_vendor_id = parsed.data.assignedVendorId;
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

  if (parsed.data.status !== undefined && data.tenant_id) {
    try {
      const serviceClient = getServiceRoleClient();
      const { data: tenant } = await serviceClient
        .from('tenants')
        .select('email, phone')
        .eq('id', data.tenant_id)
        .maybeSingle();

      // relatedEntityType carries the new status (it's a plain text column, unlike
      // relatedEntityId which is uuid) -- a ticket legitimately moves through several distinct
      // statuses (To Do -> In Progress -> Completed), each one a real, separate event worth its
      // own notification; entity-only dedup would wrongly treat the second transition as a
      // duplicate of the first, and relatedEntityId must stay the ticket's real uuid (it's what
      // the entity's own page would query email_messages by, EMAIL.md §5).
      await dispatchEmail(serviceClient, {
        orgId: data.org_id,
        toAddress: tenant?.email ?? null,
        toUserId: null,
        templateName: 'maintenance_update',
        templateVars: { summary: data.summary, status: data.status },
        relatedEntityType: `maintenance_ticket:${data.status}`,
        relatedEntityId: data.id,
        actorUserId: user.id,
      });

      // WhatsApp reserved for the "critical/urgent" case only (WHATSAPP.md §2:
      // maintenance_update_critical) -- a routine To Do -> In Progress update on a normal-priority
      // ticket stays email-only, matching "WhatsApp should be limited to important events."
      if (data.priority === 'urgent') {
        await dispatchWhatsApp(serviceClient, {
          orgId: data.org_id,
          toPhone: tenant?.phone ?? null,
          templateName: 'maintenance_update_critical',
          variables: { summary: data.summary, status: data.status },
          relatedEntityType: `maintenance_ticket:${data.status}`,
          relatedEntityId: data.id,
          actorUserId: user.id,
        });
      }
    } catch (err) {
      console.error('[notificationDispatch] maintenance_update dispatch failed', err);
    }
  }

  return NextResponse.json({ maintenanceTicket: mapMaintenanceTicketRow(data) });
}
