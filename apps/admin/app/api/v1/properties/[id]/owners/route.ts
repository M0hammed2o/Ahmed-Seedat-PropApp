import { NextResponse, type NextRequest } from 'next/server';
import { propertyOwnerAttachSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';

// Sibling of properties/[id]/route.ts and properties/[id]/units/route.ts — same `[id]`-not-
// `[propId]` naming constraint applies (Next.js requires one slug name per path level).
type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET/POST /api/v1/properties/:propId/owners — attach an owner with a fractional ownership share
 * (API_SPEC.md §3: "attach owner + ownership_pct", TASKS.md M7). GET is a pragmatic addition
 * beyond the literal spec line: a property's current owner list has to be readable by *something*
 * before it's meaningful to attach another one, and every other resource in this API exposes a
 * matching GET.
 */
async function loadVisibleProperty(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  propertyId: string,
) {
  return supabase.from('properties').select('id, org_id').eq('id', propertyId).maybeSingle();
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id: propertyId } = await params;
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

  const { data: property, error: fetchError } = await loadVisibleProperty(supabase, propertyId);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'property_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!property) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }

  const { data, error } = await supabase
    .from('property_owners')
    .select('property_id, owner_id, ownership_pct, created_at, owners(id, name, owner_type, email, phone)')
    .eq('property_id', propertyId);

  if (error) {
    return NextResponse.json(
      { error: { code: 'property_owners_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const propertyOwners = (data ?? []).map((row) => ({
    propertyId: row.property_id as string,
    ownerId: row.owner_id as string,
    ownershipPct: row.ownership_pct as number,
    createdAt: row.created_at as string,
    owner: row.owners,
  }));

  return NextResponse.json({ propertyOwners });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: propertyId } = await params;
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

  const { data: property, error: fetchError } = await loadVisibleProperty(supabase, propertyId);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'property_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!property) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Property not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, property.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to change this property\'s owners.',
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

  const parsed = propertyOwnerAttachSchema.safeParse(body);
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

  // property_owners' own RLS policy (supabase/migrations/20260101000022) only checks the
  // *owner's* org, not the property's — an owner and a property can each independently pass RLS
  // while belonging to different orgs. This explicit cross-check is the API-layer's job per
  // PERMISSIONS.md layer 2 ("enforce role/scope checks RLS can't express cleanly") and a hard
  // tenant-isolation requirement, not an optional nicety.
  const { data: owner, error: ownerFetchError } = await supabase
    .from('owners')
    .select('id, org_id')
    .eq('id', parsed.data.ownerId)
    .maybeSingle();

  if (ownerFetchError) {
    return NextResponse.json(
      { error: { code: 'owner_fetch_failed', message: ownerFetchError.message } },
      { status: 500 },
    );
  }
  if (!owner) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Owner not found.' } },
      { status: 404 },
    );
  }
  if (owner.org_id !== property.org_id) {
    return NextResponse.json(
      {
        error: {
          code: 'org_mismatch',
          message: 'The owner and the property must belong to the same organization.',
        },
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('property_owners')
    .upsert(
      {
        property_id: propertyId,
        owner_id: parsed.data.ownerId,
        ownership_pct: parsed.data.ownershipPct,
      },
      { onConflict: 'property_id,owner_id' },
    )
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'property_owner_attach_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      propertyOwner: {
        propertyId: data.property_id,
        ownerId: data.owner_id,
        ownershipPct: data.ownership_pct,
        createdAt: data.created_at,
      },
    },
    { status: 201 },
  );
}
