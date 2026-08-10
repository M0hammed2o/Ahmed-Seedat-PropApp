import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole, requirePropertyAccess } from '@/lib/portfolio';
import { scanUploadOrRespond } from '@/lib/uploadScan';

type RouteParams = { params: Promise<{ id: string }> };

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB -- generous for a phone photo, well under the
// 25MB documents-bucket limit (photos are typically much smaller than scanned PDFs).
const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];
const SIGNED_URL_TTL_SECONDS = 300;

/**
 * GET/POST /api/v1/properties/:id/photos (Stage 4). Reuses the existing private `documents`
 * bucket/RLS/malware-scan pipeline exactly (apps/admin/app/api/v1/documents/route.ts) -- a photo
 * is a `documents` row (category 'property_photos') plus a thin `property_photos` link row
 * (is_cover), not a new bucket or a new security model (migration 20260101000080).
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

  const { data, error } = await supabase
    .from('property_photos')
    .select('id, is_cover, created_at, documents(id, storage_path, original_file_name)')
    .eq('property_id', id)
    .order('is_cover', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: { code: 'property_photos_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    is_cover: boolean;
    created_at: string;
    documents: { id: string; storage_path: string; original_file_name: string } | null;
  }[];

  const photos = await Promise.all(
    rows
      .filter((r) => r.documents !== null)
      .map(async (r) => {
        const { data: signed } = await supabase.storage
          .from('documents')
          .createSignedUrl(r.documents!.storage_path, SIGNED_URL_TTL_SECONDS);
        return {
          id: r.id,
          documentId: r.documents!.id,
          isCover: r.is_cover,
          fileName: r.documents!.original_file_name,
          signedUrl: signed?.signedUrl ?? null,
          createdAt: r.created_at,
        };
      }),
  );

  return NextResponse.json({ photos });
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

  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .select('id, org_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (propertyError) {
    return NextResponse.json(
      { error: { code: 'property_fetch_failed', message: propertyError.message } },
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
          message: 'You do not have permission to upload photos for this property.',
        },
      },
      { status: 403 },
    );
  }

  const canWriteProperty =
    (await requirePropertyAccess(supabase, propertyId, 'property_manager')) ||
    (await requirePropertyAccess(supabase, propertyId, 'owner'));
  if (!canWriteProperty) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to upload photos for this property.',
        },
      },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error: { code: 'invalid_form_data', message: 'Request body must be multipart/form-data.' },
      },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'A photo file is required.',
          field_errors: { file: ['File is required'] },
        },
      },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: { code: 'file_too_large', message: 'Photo must be 10MB or smaller.' } },
      { status: 400 },
    );
  }
  if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.type)) {
    return NextResponse.json(
      {
        error: {
          code: 'unsupported_mime_type',
          message: 'Photos must be JPEG, PNG, WebP, or HEIC.',
        },
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const scanRejection = await scanUploadOrRespond(buffer);
  if (scanRejection) return scanRejection;

  const { data: category, error: categoryError } = await supabase
    .from('document_categories')
    .select('id')
    .eq('slug', 'property_photos')
    .maybeSingle();
  if (categoryError || !category) {
    return NextResponse.json(
      {
        error: {
          code: 'category_lookup_failed',
          message: categoryError?.message ?? 'property_photos category not found.',
        },
      },
      { status: 500 },
    );
  }

  const checksum = createHash('sha256').update(buffer).digest('hex');
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const storagePath = `${property.org_id}/${propertyId}/${crypto.randomUUID()}${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json(
      { error: { code: 'storage_upload_failed', message: uploadError.message } },
      { status: 500 },
    );
  }

  const { data: documentRow, error: documentError } = await supabase
    .from('documents')
    .insert({
      org_id: property.org_id,
      property_id: propertyId,
      category_id: category.id,
      document_type: 'other',
      storage_path: storagePath,
      original_file_name: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
      checksum_sha256: checksum,
    })
    .select('id')
    .single();
  if (documentError) {
    await supabase.storage.from('documents').remove([storagePath]);
    return NextResponse.json(
      { error: { code: 'document_create_failed', message: documentError.message } },
      { status: 500 },
    );
  }

  // First photo for this property becomes the cover automatically -- otherwise a freshly
  // photographed property would show the building-graphic fallback until someone remembers to set
  // one explicitly.
  const { count: existingCount } = await supabase
    .from('property_photos')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', propertyId);

  const { data: photoRow, error: photoError } = await supabase
    .from('property_photos')
    .insert({
      property_id: propertyId,
      document_id: documentRow.id,
      is_cover: (existingCount ?? 0) === 0,
    })
    .select('id, is_cover')
    .single();
  if (photoError) {
    await supabase.storage.from('documents').remove([storagePath]);
    await supabase.from('documents').delete().eq('id', documentRow.id);
    return NextResponse.json(
      { error: { code: 'property_photo_create_failed', message: photoError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { photo: { id: photoRow.id, isCover: photoRow.is_cover } },
    { status: 201 },
  );
}
