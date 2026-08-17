import { createHash, randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ALLOWED_MIME_TYPES } from '@propvault/types';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenantSession } from '@/lib/tenantSession';
import { scanUploadOrRespond } from '@/lib/uploadScan';
import { writeAuditEvent } from '@/lib/audit';
import { notifyOwnersOfPaymentReport, mapPaymentReportRow } from '@/lib/paymentReports';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // matches /api/v1/documents' own limit

/**
 * POST /api/v1/tenant-portal/payment-reports -- WhatsApp V1 completion pass, Phase A (WORKLOG.md
 * this date). Tenant self-reports a payment (EFT with proof, or cash) against their own active
 * lease. Deliberately does NOT touch rent_schedules/cash_receipts/the ledger -- this is a claim
 * layer sitting above the existing, unchanged accounting primitives (migration 20260101000106's
 * own header comment); the row starts and stays `status = 'reported'` until an accountant+
 * reviews it via /api/v1/payment-reports/:id/{confirm,reject} (Phase B).
 *
 * Multipart, same shape as /api/v1/documents' own upload route -- but the `documents` storage
 * bucket's RLS INSERT policy requires agent+ org role (20260101000086), which a tenant
 * structurally can never hold. Rather than invent a second, parallel storage-scoping concept, this
 * route uploads via the SERVICE-ROLE client (bypassing that RLS check) while resolveTenantSession()
 * + the payment_reports table's own tenant-self RLS INSERT policy are the real authorization --
 * the same two-layer split every other tenant-portal write in this codebase already uses. Reuses
 * the exact same file-validation pipeline (MIME allowlist, size limit, scanUploadOrRespond() real
 * malware scan, SHA-256 checksum) as the staff-facing upload route, not a second one.
 */
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

  const session = await resolveTenantSession();
  if (!session || !session.leaseId || !session.propertyId) {
    return NextResponse.json(
      {
        error: {
          code: 'no_active_lease',
          message: 'No active lease on file to report a payment against.',
        },
      },
      { status: 409 },
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

  const amountRaw = form.get('amount');
  const paymentMethod = form.get('paymentMethod');
  const paymentDate = form.get('paymentDate');
  const rentScheduleId = form.get('rentScheduleId') || null;
  const file = form.get('file');

  const amount = typeof amountRaw === 'string' ? Number(amountRaw) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: { amount: ['amount must be a positive number'] },
        },
      },
      { status: 400 },
    );
  }
  if (paymentMethod !== 'eft' && paymentMethod !== 'cash' && paymentMethod !== 'other') {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: { paymentMethod: ['paymentMethod must be eft, cash, or other'] },
        },
      },
      { status: 400 },
    );
  }
  if (typeof paymentDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: { paymentDate: ['paymentDate must be YYYY-MM-DD'] },
        },
      },
      { status: 400 },
    );
  }

  const serviceClient = getServiceRoleClient();
  let documentId: string | null = null;

  if (file instanceof File) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: { code: 'file_too_large', message: 'File must be 25MB or smaller.' } },
        { status: 400 },
      );
    }
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      return NextResponse.json(
        {
          error: { code: 'unsupported_mime_type', message: `Unsupported file type: ${file.type}` },
        },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const scanRejection = await scanUploadOrRespond(buffer);
    if (scanRejection) return scanRejection;

    const checksum = createHash('sha256').update(buffer).digest('hex');
    const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    const storagePath = `${session.orgId}/${session.propertyId}/${randomUUID()}${extension}`;

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
      .eq('slug', 'receipt')
      .eq('is_default', true)
      .maybeSingle();

    const { data: doc, error: docError } = await serviceClient
      .from('documents')
      .insert({
        org_id: session.orgId,
        property_id: session.propertyId,
        category_id: category?.id,
        document_type: 'other',
        lease_id: session.leaseId,
        unit_id: session.unitId,
        tenant_id: session.tenantId,
        uploaded_by: user.id,
        storage_path: storagePath,
        original_file_name: file.name,
        mime_type: file.type,
        file_size_bytes: file.size,
        checksum_sha256: checksum,
      })
      .select('id')
      .single();
    if (docError || !doc) {
      await serviceClient.storage.from('documents').remove([storagePath]);
      return NextResponse.json(
        {
          error: { code: 'document_create_failed', message: docError?.message ?? 'Upload failed.' },
        },
        { status: 500 },
      );
    }
    documentId = doc.id;
  }

  // Insert via the caller's OWN session-bound client -- payment_reports_insert_tenant_self
  // (migration 20260101000106) is the real enforcement: tenant_id/lease_id must be the caller's
  // own, never client-asserted beyond what resolveTenantSession() already resolved server-side.
  const { data: report, error: reportError } = await supabase
    .from('payment_reports')
    .insert({
      org_id: session.orgId,
      property_id: session.propertyId,
      lease_id: session.leaseId,
      rent_schedule_id: rentScheduleId,
      tenant_id: session.tenantId,
      reported_by_tenant: true,
      reported_by_user_id: user.id,
      amount,
      payment_method: paymentMethod,
      payment_date: paymentDate,
      document_id: documentId,
    })
    .select('*')
    .single();
  if (reportError || !report) {
    return NextResponse.json(
      {
        error: { code: 'payment_report_create_failed', message: reportError?.message ?? 'Failed.' },
      },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceClient, {
    orgId: session.orgId,
    actorUserId: user.id,
    actorType: 'user',
    action: 'payment_report.reported',
    entityType: 'payment_reports',
    entityId: report.id,
    after: { amount, paymentMethod, reportedByTenant: true },
  });

  // Phase B: notify every eligible (linked, phone-on-file) owner independently -- never "the
  // org." Best-effort, gated by dispatchWhatsApp's own template-approval check (Phase K) --
  // returns template_not_approved today, correctly, without failing this request.
  await notifyOwnersOfPaymentReport(serviceClient, {
    orgId: session.orgId,
    propertyId: session.propertyId,
    paymentReportId: report.id,
    amount,
    tenantId: session.tenantId,
    paymentMethod,
    paymentDate,
  });

  // Android V1 commercial-launch pass (WORKLOG.md this date): was the raw snake_case insert
  // result -- the web form never read any field from it (just redirects on 2xx), but the native
  // Android client does, and needs the same camelCase contract GET /api/v1/payment-reports
  // already returns via mapPaymentReportRow(), not a second, inconsistent wire shape.
  return NextResponse.json({ paymentReport: mapPaymentReportRow(report) }, { status: 201 });
}
