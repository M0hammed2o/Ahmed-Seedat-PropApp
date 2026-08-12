import { NextResponse, type NextRequest } from 'next/server';
import { propertyManagementContactSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapPropertyManagementContactRow } from '@/lib/compliance';

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

  const { data: contact } = await supabase
    .from('property_management_contacts')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (!contact) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Management contact not found.' } },
      { status: 404 },
    );
  }
  if (!(await requireOrgRole(supabase, contact.org_id, 'agent'))) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to edit this contact.' } },
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
  const parsed = propertyManagementContactSchema.partial().safeParse(body);
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
  const fieldMap: Record<string, string> = {
    contactType: 'contact_type',
    name: 'name',
    companyName: 'company_name',
    registrationNumber: 'registration_number',
    contactPerson: 'contact_person',
    email: 'email',
    phone: 'phone',
    emergencyPhone: 'emergency_phone',
    address: 'address',
    accountReference: 'account_reference',
    notes: 'notes',
  };
  for (const [key, column] of Object.entries(fieldMap)) {
    const value = (parsed.data as Record<string, unknown>)[key];
    if (value !== undefined) update[column] = value;
  }

  const { data: updated, error } = await supabase
    .from('property_management_contacts')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'management_contact_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ contact: mapPropertyManagementContactRow(updated) });
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

  const { data: contact } = await supabase
    .from('property_management_contacts')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (!contact) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Management contact not found.' } },
      { status: 404 },
    );
  }
  if (!(await requireOrgRole(supabase, contact.org_id, 'agent'))) {
    return NextResponse.json(
      {
        error: { code: 'forbidden', message: 'You do not have permission to delete this contact.' },
      },
      { status: 403 },
    );
  }

  const { error } = await supabase.from('property_management_contacts').delete().eq('id', id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'management_contact_delete_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ deleted: true });
}
