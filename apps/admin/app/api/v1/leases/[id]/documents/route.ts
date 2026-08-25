import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { scanUploadOrRespond } from '@/lib/uploadScan';
import { validateDocxContent } from '@/lib/leaseTemplateValidation';
import { createLeaseDocumentVersion } from '@/lib/leaseDocuments';
import { mapLeaseDocumentRow } from '@/lib/leasing';

type RouteParams = { params: Promise<{ id: string }> };

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// PDF or DOCX -- a completed/signed lease is typically a PDF; a still-editable draft might be DOCX.
// Deliberately narrower than ALLOWED_MIME_TYPES (no image types -- a photographed lease page isn't
// a valid lease document upload).
const UPLOAD_MIME_TYPES = ['application/pdf', DOCX_MIME] as const;

/** GET /api/v1/leases/:id/documents -- full version history (Phase N), newest first. */
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
    .from('lease_documents')
    .select('*')
    .eq('lease_id', id)
    .order('version', { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_documents_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ leaseDocuments: (data ?? []).map(mapLeaseDocumentRow) });
}

/**
 * POST /api/v1/leases/:id/documents (Phase P: manual completed-lease upload, preserved and
 * integrated into the same version-history model generation uses). No application/template
 * required -- this is the only path a manual (non-application-sourced) lease's document ever needs.
 */
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

  const { data: lease, error: leaseError } = await supabase
    .from('leases')
    .select('id, org_id, unit_id, units(property_id)')
    .eq('id', id)
    .maybeSingle();
  if (leaseError) {
    return NextResponse.json(
      { error: { code: 'lease_fetch_failed', message: leaseError.message } },
      { status: 500 },
    );
  }
  if (!lease) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Lease not found.' } }, { status: 404 });
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
  if (!(UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json(
      { error: { code: 'unsupported_mime_type', message: `Unsupported file type: ${file.type}. Use PDF or DOCX.` } },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const scanRejection = await scanUploadOrRespond(buffer);
  if (scanRejection) return scanRejection;

  if (file.type === DOCX_MIME) {
    const docxCheck = validateDocxContent(buffer);
    if (!docxCheck.valid) {
      return NextResponse.json(
        { error: { code: 'invalid_docx_content', message: docxCheck.reason } },
        { status: 400 },
      );
    }
  }

  const propertyId = (lease as unknown as { units: { property_id: string } | null }).units?.property_id;
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const storagePath = `${lease.org_id}/${propertyId}/${crypto.randomUUID()}${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json(
      { error: { code: 'storage_upload_failed', message: uploadError.message } },
      { status: 500 },
    );
  }

  const { data: documentRow, error: versionError } = await createLeaseDocumentVersion(supabase, {
    leaseId: id,
    orgId: lease.org_id,
    kind: 'uploaded',
    storagePath,
    originalFileName: file.name,
    mimeType: file.type,
    fileSizeBytes: file.size,
    generatedBy: user.id,
  });
  if (versionError) {
    await supabase.storage.from('documents').remove([storagePath]);
    return NextResponse.json(
      { error: { code: 'lease_document_create_failed', message: versionError.message } },
      { status: 500 },
    );
  }
  return NextResponse.json({ leaseDocument: mapLeaseDocumentRow(documentRow) }, { status: 201 });
}
