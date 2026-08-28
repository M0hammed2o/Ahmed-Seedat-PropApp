import { NextResponse, type NextRequest } from 'next/server';
import { propertyOwnerAttachSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

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
      {
        error: {
          code: 'property_fetch_failed',
          message: safeErrorMessage(fetchError, 'Could not load this property.', 'propertyOwners.fetchProperty'),
        },
      },
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
    .select(
      'property_id, owner_id, ownership_pct, created_at, owners(id, name, owner_type, email, phone, user_id)',
    )
    .eq('property_id', propertyId);

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'property_owners_list_failed',
          message: safeErrorMessage(error, 'Could not load owners for this property.', 'propertyOwners.list'),
        },
      },
      { status: 500 },
    );
  }

  // Owner + staff access completion pass (WORKLOG.md this date): canSelfLink tells the UI when
  // to offer "This is me" instead of "Invite" -- computed here, server-side, so the client never
  // has to guess; link_owner_to_self() (migration 20260101000088) independently re-checks the
  // same conditions, this is UI affordance only, not the security boundary.
  const canManage = await requireOrgRole(supabase, property.org_id, 'manager');
  const callerEmail = user.email?.toLowerCase() ?? null;

  const propertyOwners = (data ?? []).map((row) => {
    const owner = row.owners as unknown as {
      id: string;
      name: string;
      owner_type: string;
      email: string | null;
      phone: string | null;
      user_id: string | null;
    } | null;
    const canSelfLink =
      canManage &&
      !!owner &&
      !owner.user_id &&
      (!owner.email || owner.email.toLowerCase() === callerEmail);
    return {
      propertyId: row.property_id as string,
      ownerId: row.owner_id as string,
      ownershipPct: row.ownership_pct as number,
      createdAt: row.created_at as string,
      owner,
      canSelfLink,
    };
  });

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
      {
        error: {
          code: 'property_fetch_failed',
          message: safeErrorMessage(fetchError, 'Could not load this property.', 'propertyOwners.fetchProperty'),
        },
      },
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
          message: "You do not have permission to change this property's owners.",
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
      {
        error: {
          code: 'owner_fetch_failed',
          message: safeErrorMessage(ownerFetchError, 'Could not load this owner.', 'propertyOwners.fetchOwner'),
        },
      },
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

  // Captured before the upsert specifically so the audit write below can record what the split
  // was before this change — property_ownership_history (migration 20260101000062) already
  // tracks this at the data layer via trigger, but audit_events is the actor-attributed activity
  // log the owner-facing "who changed my ownership share" view will read from (Phase 6 governance
  // requirement), a distinct purpose from the raw ledger.
  const { data: priorOwnership } = await supabase
    .from('property_owners')
    .select('ownership_pct')
    .eq('property_id', propertyId)
    .eq('owner_id', parsed.data.ownerId)
    .maybeSingle();

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
      {
        error: {
          code: 'property_owner_attach_failed',
          message: safeErrorMessage(
            error,
            'Could not add this owner to the property. Please try again, or contact support if this continues.',
            'propertyOwners.attach',
          ),
        },
      },
      { status: 500 },
    );
  }

  // Bug found by property-lease-workflow.spec.ts (this task's E2E pass): entityId must be a real
  // uuid (audit_events.entity_id is `uuid not null`, migration 20260101000013) -- the previous
  // `${propertyId}:${ownerId}` composite string silently failed every insert (caught and logged by
  // writeAuditEvent, never surfaced to the caller or the response, so this went unnoticed). Since
  // property_owners has no single surrogate id (its real key is the (property_id, owner_id) pair),
  // entityId is the property being viewed when this history matters; ownerId moves into the
  // before/after payload instead of being silently dropped.
  await writeAuditEvent(getServiceRoleClient(), {
    orgId: property.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'property_owner.set_ownership_pct',
    entityType: 'property_owners',
    entityId: propertyId,
    before: priorOwnership
      ? { ownerId: parsed.data.ownerId, ownershipPct: priorOwnership.ownership_pct }
      : null,
    after: { ownerId: parsed.data.ownerId, ownershipPct: data.ownership_pct },
  });

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
