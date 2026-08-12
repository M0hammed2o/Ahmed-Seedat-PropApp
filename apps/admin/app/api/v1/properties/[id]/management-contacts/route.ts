import { NextResponse, type NextRequest } from 'next/server';
import { propertyManagementContactSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapPropertyManagementContactRow } from '@/lib/compliance';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET/POST /api/v1/properties/:id/management-contacts (PHASE 9). A property may have zero, one,
 * or several of these (e.g. both a body corporate AND its managing agent). Staff/owner only --
 * deliberately no tenant read policy on this table.
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

  const { data: contacts, error } = await supabase
    .from('property_management_contacts')
    .select('*')
    .eq('property_id', id)
    .order('created_at', { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: { code: 'management_contacts_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ contacts: (contacts ?? []).map(mapPropertyManagementContactRow) });
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

  const { data: property } = await supabase
    .from('properties')
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (!property) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }
  if (!(await requireOrgRole(supabase, property.org_id, 'agent'))) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: "You do not have permission to manage this property's contacts.",
        },
      },
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
  const parsed = propertyManagementContactSchema.safeParse(body);
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

  const { data: contact, error } = await supabase
    .from('property_management_contacts')
    .insert({
      org_id: property.org_id,
      property_id: id,
      contact_type: parsed.data.contactType,
      name: parsed.data.name,
      company_name: parsed.data.companyName ?? null,
      registration_number: parsed.data.registrationNumber ?? null,
      contact_person: parsed.data.contactPerson ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      emergency_phone: parsed.data.emergencyPhone ?? null,
      address: parsed.data.address ?? null,
      account_reference: parsed.data.accountReference ?? null,
      notes: parsed.data.notes ?? null,
      created_by: user.id,
    })
    .select('*')
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'management_contact_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ contact: mapPropertyManagementContactRow(contact) }, { status: 201 });
}
