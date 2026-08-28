import { NextResponse, type NextRequest } from 'next/server';
import { tenantMaintenanceTicketCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenantSession } from '@/lib/tenantSession';
import { mapMaintenanceTicketRow } from '@/lib/operations';
import { writeAuditEvent } from '@/lib/audit';
import { notifyPropertyStaff } from '@/lib/notify';
import { safeErrorMessage } from '@/lib/safeError';

/**
 * POST /api/v1/tenant-portal/maintenance-tickets (V1 scope correction, 2026-08-01 -- DECISIONS.md).
 * Tenant-submitted counterpart to /api/v1/maintenance-tickets (which is staff-only --
 * `submitted_by_user_id` is always set there). Resolves the caller's own tenant identity and
 * active lease server-side (never client-supplied org_id/property_id/unit_id/lease_id/tenant_id,
 * same "no client-supplied identity" rule as the announcement-acknowledge route) and inserts via
 * the caller's own session-bound client, so the RLS insert policy
 * (`maintenance_tickets_insert_tenant_self`, migration 20260101000049) is the real enforcement --
 * this route's own lookups are UX-layer only, same two-layer pattern as every other module.
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

  // Multi-tenancy architecture (WORKLOG.md this date): resolveTenantSession() picks the caller's
  // currently-ACTIVE tenancy (the active_tenant_id cookie, when it names one of the caller's own
  // tenancies, else their first) rather than this route re-deriving "some tenant row" itself with
  // its own separate, unrelated .limit(1) query -- a tenant with more than one tenancy now
  // submits a ticket against whichever tenancy their session actually has selected, not an
  // arbitrary pick independent of what the rest of the portal is showing them.
  const session = await resolveTenantSession();
  if (!session) {
    return NextResponse.json(
      {
        error: {
          code: 'not_a_tenant',
          message: 'This account has no tenant identity to submit a ticket with.',
        },
      },
      { status: 403 },
    );
  }
  const tenantRow = { id: session.tenantId, org_id: session.orgId };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = tenantMaintenanceTicketCreateSchema.safeParse(body);
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

  // Property/unit context comes from the tenant's own active lease, not the request body -- a
  // tenant submitting a ticket cannot tag it against a property they don't actually occupy.
  const { data: leaseTenant, error: leaseTenantError } = await supabase
    .from('lease_tenants')
    .select('lease_id, leases(status, unit_id, units(property_id))')
    .eq('tenant_id', tenantRow.id);
  if (leaseTenantError) {
    return NextResponse.json(
      {
        error: {
          code: 'lease_lookup_failed',
          message: safeErrorMessage(leaseTenantError, 'Could not verify your lease.', 'tenantPortal.maintenanceTickets.leaseLookup'),
        },
      },
      { status: 500 },
    );
  }

  type LeaseTenantRow = {
    lease_id: string;
    leases: { status: string; unit_id: string; units: { property_id: string } | null } | null;
  };
  const rows = (leaseTenant ?? []) as unknown as LeaseTenantRow[];
  const activeLease = rows.find((row) => row.leases?.status === 'active') ?? rows[0];
  if (!activeLease?.leases?.units?.property_id) {
    return NextResponse.json(
      {
        error: {
          code: 'no_active_lease',
          message: 'No lease on file to submit a maintenance ticket against.',
        },
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from('maintenance_tickets')
    .insert({
      org_id: tenantRow.org_id,
      property_id: activeLease.leases.units.property_id,
      unit_id: activeLease.leases.unit_id,
      lease_id: activeLease.lease_id,
      tenant_id: tenantRow.id,
      submitted_by_tenant_id: tenantRow.id,
      summary: parsed.data.summary,
      description: parsed.data.description ?? null,
      priority: parsed.data.priority,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'maintenance_ticket_create_failed',
          message: safeErrorMessage(
            error,
            'Could not submit your maintenance request. Please try again, or contact your property manager if this continues.',
            'tenantPortal.maintenanceTickets.create',
          ),
        },
      },
      { status: 500 },
    );
  }

  // Tenant access audit logging (WORKLOG.md this date) -- audit_events has no client insert
  // policy (service-role only, same as every other writeAuditEvent() call site in this
  // codebase); the primary insert above still runs through the caller's own session-bound
  // client, so RLS remains the actual enforcement for the write itself.
  await writeAuditEvent(getServiceRoleClient(), {
    orgId: tenantRow.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'tenant_maintenance_ticket.created',
    entityType: 'maintenance_tickets',
    entityId: data.id,
    after: { propertyId: data.property_id, unitId: data.unit_id, priority: data.priority },
  });

  // V1 launch-completion pass (WORKLOG.md this date): notify property staff (agent+) that a
  // tenant reported a real issue. Fail-soft and after the primary insert has already succeeded,
  // so it can never affect this route's success response. No excludeUserId -- the actor here is
  // a tenant, never a staff member, so there is no self-notification to skip.
  await notifyPropertyStaff(getServiceRoleClient(), {
    orgId: tenantRow.org_id,
    propertyId: data.property_id,
    type: 'maintenance_ticket_created',
    title: 'New maintenance request',
    body: `A tenant reported: ${parsed.data.summary}`,
    relatedEntityType: 'maintenance_ticket',
    relatedEntityId: data.id,
  });

  return NextResponse.json({ maintenanceTicket: mapMaintenanceTicketRow(data) }, { status: 201 });
}
