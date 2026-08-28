import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { documentUploadMetadataSchema } from '@propvault/validation';
import { ALLOWED_MIME_TYPES } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole, requirePropertyAccess } from '@/lib/portfolio';
import { mapDocumentRow } from '@/lib/documents';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';
import { scanUploadOrRespond } from '@/lib/uploadScan';
import { safeErrorMessage } from '@/lib/safeError';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB, matches the storage bucket's own file_size_limit

/**
 * GET/POST /api/v1/documents (API_SPEC.md §7, TASKS.md M11/M20). First real implementation --
 * M11 scoped only the schema/RLS cutover, this closes the "API endpoints/Web UI ... not started"
 * gap it left open. Upload is multipart (file + metadata fields), handled entirely server-side by
 * this route (parse -> validate -> hash -> upload to Storage -> insert row) using the caller's own
 * session-bound client throughout -- a plain RLS-protected write (API_SPEC.md §0), not a
 * service-role bypass; only the separate /extract route needs service-role, for
 * extraction_jobs/extraction_results specifically.
 */
export async function GET(request: NextRequest) {
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

  const { limit, cursor } = parseListQuery(request);
  const url = new URL(request.url);
  const propertyIdFilter = url.searchParams.get('filter[property_id]');
  // Android V1 last local blocker pass (WORKLOG.md this date): lets both the staff web ticket
  // detail view and the tenant/owner Android app list a maintenance ticket's attached documents
  // through this same shared, already-RLS-scoped endpoint -- no new route needed.
  const maintenanceTicketIdFilter = url.searchParams.get('filter[maintenance_ticket_id]');

  let query = supabase
    .from('documents')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (propertyIdFilter) query = query.eq('property_id', propertyIdFilter);
  if (maintenanceTicketIdFilter) query = query.eq('maintenance_ticket_id', maintenanceTicketIdFilter);
  if (cursor) query = query.or(beforeCursorFilter(cursor));

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'documents_list_failed',
          message: safeErrorMessage(
            error,
            'Could not load documents. Please try again, or contact support if this continues.',
            'documents.list',
          ),
        },
      },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const documents = rows.map(mapDocumentRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;

  return NextResponse.json({ documents, next_cursor: nextCursor });
}

export async function POST(request: NextRequest) {
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
          message: 'A file is required.',
          field_errors: { file: ['File is required'] },
        },
      },
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
      { error: { code: 'unsupported_mime_type', message: `Unsupported file type: ${file.type}` } },
      { status: 400 },
    );
  }

  const parsed = documentUploadMetadataSchema.safeParse({
    orgId: form.get('orgId'),
    propertyId: form.get('propertyId'),
    categoryId: form.get('categoryId'),
    documentType: form.get('documentType'),
    leaseId: form.get('leaseId') || null,
    unitId: form.get('unitId') || null,
    tenantId: form.get('tenantId') || null,
    maintenanceTicketId: form.get('maintenanceTicketId') || null,
    originalFileName: file.name,
    mimeType: file.type,
    fileSizeBytes: file.size,
  });
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

  const canWrite = await requireOrgRole(supabase, parsed.data.orgId, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to upload documents for this organization.',
        },
      },
      { status: 403 },
    );
  }

  // Storage/RLS closure pass (WORKLOG.md this date): org role alone isn't enough once
  // property_access_mode = 'selected' staff exist -- without this, a selected-mode staffer with
  // no grant on this property would still pass the org check above and reach the storage upload
  // (now blocked at the RLS layer too, 20260101000086, but that surfaces as an opaque 500; this
  // gives the real 403 before the file ever leaves the request).
  const canWriteProperty =
    (await requirePropertyAccess(supabase, parsed.data.propertyId, 'property_manager')) ||
    (await requirePropertyAccess(supabase, parsed.data.propertyId, 'owner'));
  if (!canWriteProperty) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to upload documents for this property.',
        },
      },
      { status: 403 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // R-03/TECHNICAL_DEBT_REGISTER.md TD-43: real content scanning, not just the MIME-allowlist
  // check above -- after authorization (no reason to scan a file from a caller who couldn't
  // upload it anyway) and before this file's bytes ever reach Storage.
  const scanRejection = await scanUploadOrRespond(buffer);
  if (scanRejection) return scanRejection;

  const checksum = createHash('sha256').update(buffer).digest('hex');
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  // Path convention: {org_id}/{property_id}/{uuid}{ext} -- the leading {org_id} segment is what
  // the storage.objects RLS policy actually checks (TECHNICAL_DEBT_REGISTER.md TD-21, fixed
  // alongside this route in migration 20260101000048); everything after it is organisational.
  const storagePath = `${parsed.data.orgId}/${parsed.data.propertyId}/${crypto.randomUUID()}${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json(
      {
        error: {
          code: 'storage_upload_failed',
          message: safeErrorMessage(
            uploadError,
            'Could not upload this document. Please try again, or contact support if this continues.',
            `documents.storageUpload(${storagePath})`,
          ),
        },
      },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      org_id: parsed.data.orgId,
      property_id: parsed.data.propertyId,
      category_id: parsed.data.categoryId,
      document_type: parsed.data.documentType,
      lease_id: parsed.data.leaseId ?? null,
      unit_id: parsed.data.unitId ?? null,
      tenant_id: parsed.data.tenantId ?? null,
      maintenance_ticket_id: parsed.data.maintenanceTicketId ?? null,
      uploaded_by: user.id,
      storage_path: storagePath,
      original_file_name: parsed.data.originalFileName,
      mime_type: parsed.data.mimeType,
      file_size_bytes: parsed.data.fileSizeBytes,
      checksum_sha256: checksum,
    })
    .select('*')
    .single();

  if (error) {
    // Row insert failed after a successful storage upload -- clean up the now-orphaned object
    // rather than leaving it unreferenced (best-effort; the object is harmless-but-wasted if this
    // also fails, never a security issue since it's still org-scoped by path).
    await supabase.storage.from('documents').remove([storagePath]);
    return NextResponse.json(
      {
        error: {
          code: 'document_create_failed',
          message: safeErrorMessage(
            error,
            'Could not save this document. Please try again, or contact support if this continues.',
            `documents.create(${storagePath})`,
          ),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ document: mapDocumentRow(data) }, { status: 201 });
}
