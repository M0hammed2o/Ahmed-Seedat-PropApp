import { NextResponse, type NextRequest } from 'next/server';
import { tenantMaintenanceTicketCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapMaintenanceTicketRow } from '@/lib/operations';

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

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, org_id')
    .eq('user_id', user.id)
    .limit(1);
  if (tenantError) {
    return NextResponse.json(
      { error: { code: 'tenant_fetch_failed', message: tenantError.message } },
      { status: 500 },
    );
  }
  const tenantRow = tenant?.[0];
  if (!tenantRow) {
    return NextResponse.json(
      { error: { code: 'not_a_tenant', message: 'This account has no tenant identity to submit a ticket with.' } },
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
      { error: { code: 'lease_lookup_failed', message: leaseTenantError.message } },
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
      { error: { code: 'maintenance_ticket_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ maintenanceTicket: mapMaintenanceTicketRow(data) }, { status: 201 });
}
