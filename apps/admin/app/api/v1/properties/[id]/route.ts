import { NextResponse, type NextRequest } from 'next/server';
import { propertyUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPropertyRow, requireOrgRole } from '@/lib/portfolio';
import { getGeocodingProvider } from '@/lib/providers/geocoding';

type RouteParams = { params: Promise<{ id: string }> };

// API_SPEC.md §0: "a resource in another org 404s, never 403, so org existence isn't leaked by
// status code." Achieved by always SELECTing through the caller's own RLS-scoped client first —
// if RLS hides the row (wrong org entirely), that query itself returns zero rows, indistinguishable
// from a truly nonexistent id. A 403 is only ever returned once the row IS visible (same org,
// caller confirmed a member) but the caller's role is below the required floor.
async function loadVisibleProperty(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  id: string,
) {
  return supabase.from('properties').select('*').eq('id', id).maybeSingle();
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

  const { data, error } = await loadVisibleProperty(supabase, id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'property_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ property: mapPropertyRow(data) });
}

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

  const { data: existing, error: fetchError } = await loadVisibleProperty(supabase, id);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'property_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to edit this property.' } },
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

  const parsed = propertyUpdateSchema.safeParse(body);
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

  const patch: Record<string, unknown> = {};
  if (parsed.data.nickname !== undefined) patch.nickname = parsed.data.nickname;
  if (parsed.data.addressLine1 !== undefined) patch.address_line1 = parsed.data.addressLine1;
  if (parsed.data.addressLine2 !== undefined) patch.address_line2 = parsed.data.addressLine2;
  if (parsed.data.suburb !== undefined) patch.suburb = parsed.data.suburb;
  if (parsed.data.city !== undefined) patch.city = parsed.data.city;
  if (parsed.data.province !== undefined) patch.province = parsed.data.province;
  if (parsed.data.postalCode !== undefined) patch.postal_code = parsed.data.postalCode;
  if (parsed.data.country !== undefined) patch.country = parsed.data.country;
  if (parsed.data.propertyType !== undefined) patch.property_type = parsed.data.propertyType;
  if (parsed.data.municipalAccountNumber !== undefined)
    patch.municipal_account_number = parsed.data.municipalAccountNumber;
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  if (parsed.data.estimatedValue !== undefined) {
    patch.estimated_value = parsed.data.estimatedValue;
    // Who captured it, tracked automatically -- the caller never supplies this directly.
    patch.estimated_value_updated_by = user.id;
  }
  if (parsed.data.estimatedValueAsOf !== undefined) patch.estimated_value_as_of = parsed.data.estimatedValueAsOf;

  const { data, error } = await supabase
    .from('properties')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'property_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  let property = mapPropertyRow(data);

  // Re-geocode only when an address field actually changed (2026-08-04, Owner Dashboard map) --
  // avoids a wasted API call on every unrelated edit (e.g. just updating notes). Best-effort, same
  // as the create path: never blocks or fails the update itself.
  const addressChanged = [
    'addressLine1',
    'addressLine2',
    'suburb',
    'city',
    'province',
    'postalCode',
    'country',
  ].some((key) => key in parsed.data);
  if (addressChanged) {
    const coords = await getGeocodingProvider().geocode(property.fullAddress);
    const { data: geocoded, error: geocodeError } = await supabase
      .from('properties')
      .update({ latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null })
      .eq('id', id)
      .select('*')
      .single();
    if (!geocodeError && geocoded) property = mapPropertyRow(geocoded);
  }

  return NextResponse.json({ property });
}

/**
 * DELETE = archive, never a hard delete (API_SPEC.md §3: "DELETE = archive, never hard-delete") —
 * a property has bills/leases/documents that must survive its removal from the active portfolio
 * view.
 */
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

  const { data: existing, error: fetchError } = await loadVisibleProperty(supabase, id);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'property_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to archive this property.' } },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('properties')
    .update({ status: 'archived' })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'property_archive_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ property: mapPropertyRow(data) });
}
