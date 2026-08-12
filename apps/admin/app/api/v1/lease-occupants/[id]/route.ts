import { NextResponse, type NextRequest } from 'next/server';
import { leaseOccupantSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapLeaseOccupantRow } from '@/lib/compliance';

type RouteParams = { params: Promise<{ id: string }> };

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

  const { data: occupant } = await supabase
    .from('lease_occupants')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (!occupant) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Occupant not found.' } },
      { status: 404 },
    );
  }
  if (!(await requireOrgRole(supabase, occupant.org_id, 'agent'))) {
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
  const parsed = leaseOccupantSchema.partial().safeParse(body);
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

  const update: Record<string, unknown> = {};
  if (parsed.data.fullName !== undefined) update.full_name = parsed.data.fullName;
  if (parsed.data.occupantType !== undefined) update.occupant_type = parsed.data.occupantType;
  if (parsed.data.relationship !== undefined) update.relationship = parsed.data.relationship;
  if (parsed.data.moveInDate !== undefined) update.move_in_date = parsed.data.moveInDate;
  if (parsed.data.moveOutDate !== undefined) update.move_out_date = parsed.data.moveOutDate;
  if (parsed.data.isActive !== undefined) update.is_active = parsed.data.isActive;
  if (parsed.data.contactPhone !== undefined) update.contact_phone = parsed.data.contactPhone;
  if (parsed.data.contactEmail !== undefined) update.contact_email = parsed.data.contactEmail;
  if (parsed.data.complianceApplicable !== undefined)
    update.compliance_applicable = parsed.data.complianceApplicable;
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;

  const { data: updated, error } = await supabase
    .from('lease_occupants')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'occupant_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ occupant: mapLeaseOccupantRow(updated) });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
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

  const { data: occupant } = await supabase
    .from('lease_occupants')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (!occupant) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Occupant not found.' } },
      { status: 404 },
    );
  }
  if (!(await requireOrgRole(supabase, occupant.org_id, 'agent'))) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to manage occupants.' } },
      { status: 403 },
    );
  }

  const { error } = await supabase.from('lease_occupants').delete().eq('id', id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'occupant_delete_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ deleted: true });
}
