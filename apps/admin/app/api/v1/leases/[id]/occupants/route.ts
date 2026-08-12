import { NextResponse, type NextRequest } from 'next/server';
import { leaseOccupantSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapLeaseOccupantRow } from '@/lib/compliance';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET/POST /api/v1/leases/:id/occupants (PHASE 8). Deliberately NOT an auth/portal-access flow --
 * this only records who is recorded as living in the unit (name/relationship/dates), never
 * creates an auth.users row. agent+ to write, viewer+ to read (mirrors leases' own write floor);
 * the caller's own tenant self-read policy additionally lets a tenant on this lease read (not
 * write) their own household's occupant list.
 */
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

  const { data: occupants, error } = await supabase
    .from('lease_occupants')
    .select('*')
    .eq('lease_id', id)
    .order('created_at', { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: { code: 'occupants_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ occupants: (occupants ?? []).map(mapLeaseOccupantRow) });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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

  const { data: lease } = await supabase.from('leases').select('org_id').eq('id', id).maybeSingle();
  if (!lease) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Lease not found.' } },
      { status: 404 },
    );
  }
  if (!(await requireOrgRole(supabase, lease.org_id, 'agent'))) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to manage occupants.' } },
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
  const parsed = leaseOccupantSchema.safeParse(body);
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

  const { data: occupant, error } = await supabase
    .from('lease_occupants')
    .insert({
      org_id: lease.org_id,
      lease_id: id,
      full_name: parsed.data.fullName,
      occupant_type: parsed.data.occupantType,
      relationship: parsed.data.relationship ?? null,
      move_in_date: parsed.data.moveInDate ?? null,
      move_out_date: parsed.data.moveOutDate ?? null,
      is_active: parsed.data.isActive,
      contact_phone: parsed.data.contactPhone ?? null,
      contact_email: parsed.data.contactEmail ?? null,
      compliance_applicable: parsed.data.complianceApplicable,
      notes: parsed.data.notes ?? null,
    })
    .select('*')
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'occupant_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ occupant: mapLeaseOccupantRow(occupant) }, { status: 201 });
}
