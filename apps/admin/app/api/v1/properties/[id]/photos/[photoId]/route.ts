import { revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string; photoId: string }> };

const setCoverSchema = z.object({ isCover: z.literal(true) });

async function loadPhoto(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  propertyId: string,
  photoId: string,
) {
  return supabase
    .from('property_photos')
    .select(
      'id, property_id, document_id, is_cover, hero_storage_path, card_storage_path, properties(org_id), documents(storage_path)',
    )
    .eq('id', photoId)
    .eq('property_id', propertyId)
    .maybeSingle();
}

/** PATCH /api/v1/properties/:id/photos/:photoId -- set as cover photo (the only mutable field). */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: propertyId, photoId } = await params;
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

  const { data, error } = await loadPhoto(supabase, propertyId, photoId);
  if (error) {
    return NextResponse.json(
      { error: { code: 'property_photo_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  const photo = data as unknown as {
    id: string;
    is_cover: boolean;
    properties: { org_id: string } | null;
  } | null;
  if (!photo || !photo.properties) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Photo not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, photo.properties.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to edit this photo.' } },
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
  const parsed = setCoverSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'isCover must be true.' } },
      { status: 400 },
    );
  }

  if (photo.is_cover) {
    // Already the cover -- a no-op, not an error (matches this codebase's own established
    // idempotent-mutation convention elsewhere, e.g. cancelOrgSubscription()).
    return NextResponse.json({ ok: true });
  }

  const { data: previousCover } = await supabase
    .from('property_photos')
    .select('id')
    .eq('property_id', propertyId)
    .eq('is_cover', true)
    .maybeSingle();

  // Demote any other cover first -- property_photos_one_cover_idx (migration 20260101000080)
  // would otherwise reject the new cover as a duplicate.
  await supabase
    .from('property_photos')
    .update({ is_cover: false })
    .eq('property_id', propertyId)
    .eq('is_cover', true);

  const { error: updateError } = await supabase
    .from('property_photos')
    .update({ is_cover: true })
    .eq('id', photoId);
  if (updateError) {
    return NextResponse.json(
      { error: { code: 'property_photo_update_failed', message: updateError.message } },
      { status: 500 },
    );
  }

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: photo.properties.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'property.photo_cover_changed',
    entityType: 'property_photos',
    entityId: photoId,
    propertyId,
    before: { coverPhotoId: previousCover?.id ?? null },
    after: { coverPhotoId: photoId },
  });

  revalidatePath('/properties');
  revalidatePath(`/properties/${propertyId}`);

  return NextResponse.json({ ok: true });
}

/** DELETE /api/v1/properties/:id/photos/:photoId -- removes the link row, the documents row, and the storage object. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id: propertyId, photoId } = await params;
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

  const { data, error } = await loadPhoto(supabase, propertyId, photoId);
  if (error) {
    return NextResponse.json(
      { error: { code: 'property_photo_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  const photo = data as unknown as {
    id: string;
    document_id: string;
    is_cover: boolean;
    hero_storage_path: string | null;
    card_storage_path: string | null;
    properties: { org_id: string } | null;
    documents: { storage_path: string } | null;
  } | null;
  if (!photo || !photo.properties) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Photo not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, photo.properties.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to remove this photo.' } },
      { status: 403 },
    );
  }

  // documents row cascade-deletes the property_photos row (on delete cascade, migration
  // 20260101000080) -- deleting the parent is enough, no separate property_photos delete needed.
  const { error: deleteError } = await supabase
    .from('documents')
    .delete()
    .eq('id', photo.document_id);
  if (deleteError) {
    return NextResponse.json(
      { error: { code: 'property_photo_delete_failed', message: deleteError.message } },
      { status: 500 },
    );
  }

  const storagePathsToRemove = [
    photo.documents?.storage_path,
    photo.hero_storage_path,
    photo.card_storage_path,
  ].filter((p): p is string => p !== null && p !== undefined);
  if (storagePathsToRemove.length > 0) {
    await supabase.storage.from('documents').remove(storagePathsToRemove);
  }

  // If the deleted photo was the cover, promote the oldest remaining photo so the property never
  // silently loses its hero image just because the current cover was removed. No remaining photo
  // -> nothing to promote, and every reader's fallback rule (resolveCoverPhotoRow()) already
  // renders the generic placeholder cleanly when property_photos has zero rows.
  let promotedCoverId: string | null = null;
  if (photo.is_cover) {
    const { data: next } = await supabase
      .from('property_photos')
      .select('id')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next) {
      await supabase.from('property_photos').update({ is_cover: true }).eq('id', next.id);
      promotedCoverId = next.id;
    }
  }

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: photo.properties.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'property.photo_removed',
    entityType: 'property_photos',
    entityId: photoId,
    propertyId,
    before: { wasCover: photo.is_cover },
    after: { promotedCoverPhotoId: promotedCoverId },
  });

  revalidatePath('/properties');
  revalidatePath(`/properties/${propertyId}`);

  return NextResponse.json({ ok: true });
}
