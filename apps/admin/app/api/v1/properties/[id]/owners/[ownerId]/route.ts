import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

// Sibling of properties/[id]/photos/[photoId]/route.ts -- same nested-dynamic-segment shape for a
// scoped sub-resource delete.
type RouteParams = { params: Promise<{ id: string; ownerId: string }> };

/**
 * DELETE /api/v1/properties/:id/owners/:ownerId -- removes the property_owners RELATIONSHIP row
 * only. Never deletes the owners identity row -- that stays a separate, not-yet-supported action
 * (apps/admin/app/api/v1/owners/[id]/route.ts intentionally has no DELETE). The
 * property_ownership_history audit ledger (migration 20260101000062) keeps recording this via its
 * own insert/update/delete trigger on property_owners -- untouched by this route, it just fires
 * naturally off the delete below.
 *
 * RLS enforcement: property_owners already carries a `for all` write policy
 * (property_owners_write_agent_plus_and_property_access, migration 20260101000084) that covers
 * DELETE via its USING clause (org agent+ role AND owner/administrator property_access) --
 * confirmed by grep across every migration touching property_owners before writing this route, see
 * migration 20260101000144's own comment. No new policy needed. The requireOrgRole check below
 * mirrors the sibling POST handler's app-layer check (same file) for a friendly 403 message before
 * hitting the database; the count check after the delete catches the case where the caller clears
 * the org-role floor but is blocked by the stricter property-level RLS clause, so a silently
 * RLS-filtered delete is reported as "forbidden", never as a false "deleted": true.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id: propertyId, ownerId } = await params;
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

  const { data: property, error: fetchError } = await supabase
    .from('properties')
    .select('id, org_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'property_fetch_failed',
          message: safeErrorMessage(
            fetchError,
            'Could not load this property.',
            'properties/[id]/owners/[ownerId] DELETE property fetch',
          ),
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

  const { data: existing, error: existingError } = await supabase
    .from('property_owners')
    .select('ownership_pct')
    .eq('property_id', propertyId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json(
      {
        error: {
          code: 'property_owner_fetch_failed',
          message: safeErrorMessage(
            existingError,
            'Could not check this property’s ownership records.',
            'properties/[id]/owners/[ownerId] DELETE existing fetch',
          ),
        },
      },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'This owner is not attached to this property.' } },
      { status: 404 },
    );
  }

  const { error: deleteError, count } = await supabase
    .from('property_owners')
    .delete({ count: 'exact' })
    .eq('property_id', propertyId)
    .eq('owner_id', ownerId);

  if (deleteError) {
    return NextResponse.json(
      {
        error: {
          code: 'property_owner_remove_failed',
          message: safeErrorMessage(
            deleteError,
            'Failed to remove this owner from the property.',
            'properties/[id]/owners/[ownerId] DELETE',
          ),
        },
      },
      { status: 500 },
    );
  }
  if (!count) {
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

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: property.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'property.ownership_removed',
    entityType: 'property_owners',
    entityId: propertyId,
    propertyId,
    before: { ownerId, ownershipPct: existing.ownership_pct },
    after: null,
  });

  return NextResponse.json({ deleted: true });
}
