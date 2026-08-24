import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ALLOWED_MIME_TYPES } from '@propvault/types';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { scanUploadOrRespond } from '@/lib/uploadScan';

type RouteParams = { params: Promise<{ token: string }> };

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB, matches every other upload route in this app

/**
 * POST /api/v1/apply/:token/documents (Phase 6-7, migration 20260101000132). Public, token-scoped.
 *
 * The applicant has no org membership, so they cannot satisfy storage.objects' own property-scoped
 * INSERT policy the way a real staff upload does -- this route therefore uploads the bytes with the
 * SERVICE ROLE client (getServiceRoleClient(), never exposed to the browser) instead, but ONLY
 * after get_application_by_token() has already confirmed the token is valid and resolved exactly
 * which org/property this upload is allowed to belong to. The server -- not the caller -- builds
 * the storage path from that resolved org/property id, so a caller can never direct the write
 * anywhere else. record_application_document_upload() (SECURITY DEFINER) then does the actual
 * `documents` row insert + requirement status update, re-validating the token itself independently
 * rather than trusting that this route already did.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token } = await params;
  const supabase = await getServerSupabaseClient();

  const { data: appData, error: appError } = await supabase
    .rpc('get_application_by_token', { p_token: token })
    .single();
  if (appError) {
    return NextResponse.json(
      { error: { code: 'application_lookup_failed', message: appError.message } },
      { status: 500 },
    );
  }
  const app = appData as {
    valid: boolean;
    error_code: string | null;
    org_id: string | null;
    property_id: string | null;
  };
  if (!app.valid || !app.org_id || !app.property_id) {
    return NextResponse.json(
      { error: { code: app.error_code ?? 'invalid_token', message: 'This link is no longer valid.' } },
      { status: 410 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_form_data', message: 'Request body must be multipart/form-data.' } },
      { status: 400 },
    );
  }

  const requirementKey = form.get('requirementKey');
  if (typeof requirementKey !== 'string' || requirementKey.length === 0) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'requirementKey is required.' } },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'A file is required.' } },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: { code: 'file_too_large', message: 'File must be 25MB or smaller.' } },
      { status: 400 },
    );
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json(
      {
        error: {
          code: 'unsupported_mime_type',
          message: `Unsupported file type: ${file.type}. Use PDF, JPEG, PNG, or HEIC.`,
        },
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const scanRejection = await scanUploadOrRespond(buffer);
  if (scanRejection) return scanRejection;

  const checksum = createHash('sha256').update(buffer).digest('hex');
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const storagePath = `${app.org_id}/${app.property_id}/${crypto.randomUUID()}${extension}`;

  const serviceRole = getServiceRoleClient();
  const { error: uploadError } = await serviceRole.storage
    .from('documents')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json(
      { error: { code: 'storage_upload_failed', message: uploadError.message } },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .rpc('record_application_document_upload', {
      p_token: token,
      p_requirement_key: requirementKey,
      p_storage_path: storagePath,
      p_original_file_name: file.name,
      p_mime_type: file.type,
      p_file_size_bytes: file.size,
      p_checksum_sha256: checksum,
    })
    .single();

  if (error) {
    await serviceRole.storage.from('documents').remove([storagePath]);
    return NextResponse.json(
      { error: { code: 'document_record_failed', message: error.message } },
      { status: 500 },
    );
  }

  const row = data as { success: boolean; error_code: string | null; document_id: string | null };
  if (!row.success) {
    await serviceRole.storage.from('documents').remove([storagePath]);
    return NextResponse.json(
      { error: { code: row.error_code ?? 'document_record_failed', message: 'Could not record this upload.' } },
      { status: 400 },
    );
  }

  return NextResponse.json({ documentId: row.document_id }, { status: 201 });
}
