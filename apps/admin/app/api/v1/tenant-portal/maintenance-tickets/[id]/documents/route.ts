import { createHash, randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ALLOWED_MIME_TYPES } from '@propvault/types';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenantSession } from '@/lib/tenantSession';
import { scanUploadOrRespond } from '@/lib/uploadScan';
import { writeAuditEvent } from '@/lib/audit';
import { mapDocumentRow } from '@/lib/documents';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // matches /api/v1/documents' own limit

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/tenant-portal/maintenance-tickets/:id/documents (Android V1 last local blocker
 * pass, WORKLOG.md this date). Lets a tenant attach a photo/file to their OWN maintenance ticket,
 * reusing the existing `documents` table/private-bucket infrastructure (`documents.
 * maintenance_ticket_id`, added 20260101000085) rather than adding binary columns to
 * `maintenance_tickets`.
 *
 * Same two-layer pattern as /api/v1/tenant-portal/payment-reports' own file upload: neither
 * `documents` nor `storage.objects` (bucket 'documents') has any tenant-self INSERT policy
 * (both are staff-only, 20260101000067/20260101000086) -- rather than add a new, narrow,
 * one-off RLS policy for this single flow, this uploads via the SERVICE-ROLE client (bypassing
 * that RLS) with this route's own server-side validation as the real authorization: the ticket
 * ownership check below (querying maintenance_tickets through the caller's OWN session-bound
 * client, so `maintenance_tickets_select_tenant_self` RLS is what actually proves the ticket is
 * this tenant's) is what a client can never fake, not the service-role write that follows it.
 *
 * The created document row's `lease_id` is set to the ticket's own lease_id -- this is the
 * EXISTING, already-proven mechanism `documents_select_tenant_self` (20260101000049) uses to
 * grant a tenant read access to a document ("Tags the upload as tenant-visible... deliberately
 * opt-in per upload"), so the tenant can read this attachment back later (e.g. reopening the
 * ticket detail screen) with ZERO new RLS policy needed -- exactly the "prefer existing document
 * infrastructure over new schema" instruction this pass was given.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: ticketId } = await params;
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

  const session = await resolveTenantSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: 'not_a_tenant', message: 'This account has no tenant identity.' } },
      { status: 403 },
    );
  }

  // Ownership check through the caller's OWN client -- maintenance_tickets_select_tenant_self
  // (20260101000049) is the real proof this ticket belongs to this tenant, not merely this
  // route's own logic. A ticket that exists but isn't this tenant's returns no row here (RLS),
  // indistinguishable from a ticket that doesn't exist at all -- deliberately 404 either way, not
  // 403, so this endpoint never confirms another tenant's ticket ID is valid.
  const { data: ticket, error: ticketError } = await supabase
    .from('maintenance_tickets')
    .select('id, org_id, property_id, lease_id, tenant_id')
    .eq('id', ticketId)
    .maybeSingle();
  if (ticketError) {
    return NextResponse.json(
      { error: { code: 'ticket_lookup_failed', message: ticketError.message } },
      { status: 500 },
    );
  }
  if (!ticket) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Maintenance ticket not found.' } },
      { status: 404 },
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

  const buffer = Buffer.from(await file.arrayBuffer());
  const scanRejection = await scanUploadOrRespond(buffer);
  if (scanRejection) return scanRejection;

  const checksum = createHash('sha256').update(buffer).digest('hex');
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const storagePath = `${ticket.org_id}/${ticket.property_id}/${randomUUID()}${extension}`;

  const serviceClient = getServiceRoleClient();
  const { error: uploadError } = await serviceClient.storage
    .from('documents')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json(
      { error: { code: 'storage_upload_failed', message: uploadError.message } },
      { status: 500 },
    );
  }

  const { data: category } = await serviceClient
    .from('document_categories')
    .select('id')
    .eq('slug', 'maintenance')
    .eq('is_default', true)
    .maybeSingle();

  const { data: doc, error: docError } = await serviceClient
    .from('documents')
    .insert({
      org_id: ticket.org_id,
      property_id: ticket.property_id,
      category_id: category?.id,
      document_type: 'supporting_document',
      lease_id: ticket.lease_id,
      tenant_id: ticket.tenant_id,
      maintenance_ticket_id: ticket.id,
      uploaded_by: user.id,
      storage_path: storagePath,
      original_file_name: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
      checksum_sha256: checksum,
    })
    .select('*')
    .single();
  if (docError || !doc) {
    await serviceClient.storage.from('documents').remove([storagePath]);
    return NextResponse.json(
      { error: { code: 'document_create_failed', message: docError?.message ?? 'Upload failed.' } },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId: ticket.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'maintenance_ticket_document.attached',
    entityType: 'documents',
    entityId: doc.id,
    after: { maintenanceTicketId: ticket.id, mimeType: file.type },
  });

  return NextResponse.json({ document: mapDocumentRow(doc) }, { status: 201 });
}
