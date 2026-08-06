import { NextResponse, type NextRequest } from 'next/server';
import { leaseTemplateUploadMetadataSchema } from '@propvault/validation';
import { LEASE_TEMPLATE_MIME_TYPES } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapLeaseTemplateRow } from '@/lib/leaseTemplates';
import { scanUploadOrRespond } from '@/lib/uploadScan';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // matches the 'documents' bucket's own limit, same bucket is reused

/**
 * GET/POST /api/v1/lease-templates (PWA_V1_COMPLETION_PLAN.md #9). Reuses the existing
 * 'documents' storage bucket rather than provisioning a new one -- same org_id-first path
 * convention and RLS predicate (has_org_role via has_org_role()) documents' own bucket policies
 * already established (migration 20260101000048), just a different second path segment
 * (`{org_id}/lease-templates/...` instead of `{org_id}/{property_id}/...`).
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

  const url = new URL(request.url);
  const includeArchived = url.searchParams.get('include_archived') === 'true';

  let query = supabase.from('lease_templates').select('*').order('created_at', { ascending: false });
  if (!includeArchived) query = query.eq('status', 'active');

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_templates_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ leaseTemplates: (data ?? []).map(mapLeaseTemplateRow) });
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
      { error: { code: 'invalid_form_data', message: 'Request body must be multipart/form-data.' } },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'A file is required.', field_errors: { file: ['File is required'] } } },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: { code: 'file_too_large', message: 'File must be 25MB or smaller.' } },
      { status: 400 },
    );
  }
  if (!(LEASE_TEMPLATE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json(
      { error: { code: 'unsupported_mime_type', message: `Unsupported file type: ${file.type}. Use PDF or DOCX.` } },
      { status: 400 },
    );
  }

  const isDefaultRaw = form.get('isDefault');
  const parsed = leaseTemplateUploadMetadataSchema.safeParse({
    orgId: form.get('orgId'),
    name: form.get('name'),
    isDefault: isDefaultRaw === 'true',
    supersedesId: form.get('supersedesId') || null,
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

  const canWrite = await requireOrgRole(supabase, parsed.data.orgId, 'manager');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Only principals and managers can manage lease templates.' } },
      { status: 403 },
    );
  }

  if (parsed.data.supersedesId) {
    const { data: existing, error: existingError } = await supabase
      .from('lease_templates')
      .select('id, org_id')
      .eq('id', parsed.data.supersedesId)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json(
        { error: { code: 'lease_template_fetch_failed', message: existingError.message } },
        { status: 500 },
      );
    }
    if (!existing || existing.org_id !== parsed.data.orgId) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'The template being replaced was not found.' } },
        { status: 404 },
      );
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // R-03/TECHNICAL_DEBT_REGISTER.md TD-43: same real content scan as POST /api/v1/documents.
  const scanRejection = await scanUploadOrRespond(buffer);
  if (scanRejection) return scanRejection;

  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const storagePath = `${parsed.data.orgId}/lease-templates/${crypto.randomUUID()}${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json(
      { error: { code: 'storage_upload_failed', message: uploadError.message } },
      { status: 500 },
    );
  }

  // A new default must be the org's only active default (partial unique index enforces this at
  // the DB level regardless) -- clear any existing one first so the insert below never races the
  // constraint under normal single-request use.
  if (parsed.data.isDefault) {
    await supabase
      .from('lease_templates')
      .update({ is_default: false })
      .eq('org_id', parsed.data.orgId)
      .eq('status', 'active')
      .eq('is_default', true);
  }

  const { data, error } = await supabase
    .from('lease_templates')
    .insert({
      org_id: parsed.data.orgId,
      name: parsed.data.name,
      storage_path: storagePath,
      original_file_name: parsed.data.originalFileName,
      mime_type: parsed.data.mimeType,
      file_size_bytes: parsed.data.fileSizeBytes,
      is_default: parsed.data.isDefault,
      supersedes_id: parsed.data.supersedesId ?? null,
      created_by: user.id,
    })
    .select('*')
    .single();

  if (error) {
    await supabase.storage.from('documents').remove([storagePath]);
    return NextResponse.json(
      { error: { code: 'lease_template_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  // Version history (don't overwrite executed leases, PWA_V1_COMPLETION_PLAN.md #9): the
  // replaced row is archived, never mutated/deleted -- any lease created against it keeps working
  // off its own already-downloaded/attached copy, untouched by this.
  if (parsed.data.supersedesId) {
    await supabase.from('lease_templates').update({ status: 'archived' }).eq('id', parsed.data.supersedesId);
  }

  return NextResponse.json({ leaseTemplate: mapLeaseTemplateRow(data) }, { status: 201 });
}
