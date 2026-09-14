import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole, requirePropertyAccess } from '@/lib/portfolio';
import {
  downloadProtectedObject,
  removeProtectedObjects,
  requireCleanScanBeforeProcessing,
  storeServerGeneratedObject,
} from '@/lib/protectedStorage';
import { mergeLeaseTemplate, type LeaseMergeFields } from '@/lib/leaseGeneration';
import { createLeaseDocumentVersion } from '@/lib/leaseDocuments';
import { mapLeaseDocumentRow } from '@/lib/leasing';

type RouteParams = { params: Promise<{ id: string }> };

const generateSchema = z.object({
  templateId: z.string().uuid(),
  approvedOccupants: z.string().max(500).optional().nullable(),
  parking: z.string().max(300).optional().nullable(),
  utilities: z.string().max(300).optional().nullable(),
  specialConditions: z.string().max(2000).optional().nullable(),
  rentalDueDay: z.number().int().min(1).max(31).optional().nullable(),
  annualEscalationPct: z.number().min(0).optional().nullable(),
});

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * POST /api/v1/leases/:id/documents/generate (Phase M/N). Real DOCX-template merge, not a naive
 * string replace -- mergeLeaseTemplate() (lib/leaseGeneration.ts) handles Word's own run-splitting
 * via docxtemplater. Generating never sends; it only produces a new draft lease_documents version
 * (Phase S's explicit-send is a separate, later action).
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }
  const parsed = generateSchema.safeParse(body);
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

  const { data: lease, error: leaseError } = await supabase
    .from('leases')
    .select(
      '*, units(unit_label, bedrooms, bathrooms, property_id, properties(nickname, full_address)), organizations(trading_name, legal_name)',
    )
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

  // The merged document is written by the server (clients have no Storage write policy, migration
  // 20260101000171), so the permission the storage.objects INSERT policy used to enforce is checked
  // here, before the template is read or anything is written: agent+ with manager/owner access to
  // the property -- the same bar lease_documents_insert_staff already sets for the version row.
  const leasePropertyId = (lease as unknown as { units: { property_id: string } | null }).units
    ?.property_id;
  const canWrite =
    Boolean(leasePropertyId) &&
    (await requireOrgRole(supabase, lease.org_id, 'agent')) &&
    ((await requirePropertyAccess(supabase, leasePropertyId!, 'property_manager')) ||
      (await requirePropertyAccess(supabase, leasePropertyId!, 'owner')));
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to generate documents for this lease.',
        },
      },
      { status: 403 },
    );
  }

  const { data: leaseTenant } = await supabase
    .from('lease_tenants')
    .select('tenants(full_name, email, phone)')
    .eq('lease_id', id)
    .eq('is_primary', true)
    .maybeSingle();
  const tenant = (leaseTenant as unknown as { tenants: { full_name: string; email: string | null; phone: string | null } | null } | null)?.tenants;

  const { data: template, error: templateError } = await supabase
    .from('lease_templates')
    .select('*')
    .eq('id', parsed.data.templateId)
    .eq('org_id', lease.org_id)
    .maybeSingle();
  if (templateError) {
    return NextResponse.json(
      { error: { code: 'lease_template_fetch_failed', message: templateError.message } },
      { status: 500 },
    );
  }
  if (!template) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Lease template not found for this organization.' } },
      { status: 404 },
    );
  }

  if (template.mime_type !== DOCX_MIME) {
    return NextResponse.json(
      { error: { code: 'unsupported_template_type', message: 'Only DOCX templates can be merged. Use manual upload for PDF templates.' } },
      { status: 400 },
    );
  }

  // The template is parsed by docxtemplater below. Being in Storage doesn't prove it was scanned (an
  // older object, or one planted while clients could still write), so it must have a verified clean
  // scan -- on record, or run now -- before its bytes are processed.
  const templateClearance = await requireCleanScanBeforeProcessing({
    orgId: lease.org_id,
    storagePath: template.storage_path,
  });
  if (!templateClearance.ok) return templateClearance.response;

  // The template row was loaded for this lease's organisation; its path must sit inside that
  // organisation's folder too (also enforced by requireCleanScanBeforeProcessing() above).
  const templateDownload = await downloadProtectedObject(supabase, {
    orgId: template.org_id,
    storagePath: template.storage_path,
  });
  if (!templateDownload.ok) {
    return NextResponse.json(
      { error: { code: 'template_download_failed', message: templateDownload.message } },
      { status: templateDownload.reason === 'path_not_in_org' ? 403 : 500 },
    );
  }
  const templateFile = templateDownload.value;

  const unit = (
    lease as unknown as {
      units: {
        unit_label: string;
        bedrooms: number | null;
        bathrooms: number | null;
        property_id: string;
        properties: { nickname: string; full_address: string | null } | null;
      } | null;
    }
  ).units;
  const org = (lease as unknown as { organizations: { trading_name: string | null; legal_name: string } | null }).organizations;

  const fields: LeaseMergeFields = {
    tenant_full_name: tenant?.full_name ?? '',
    tenant_email: tenant?.email ?? '',
    tenant_phone: tenant?.phone ?? '',
    property_name: unit?.properties?.nickname ?? '',
    property_address: unit?.properties?.full_address ?? '',
    unit_label: unit?.unit_label ?? '',
    bedrooms: unit?.bedrooms != null ? String(unit.bedrooms) : '',
    bathrooms: unit?.bathrooms != null ? String(unit.bathrooms) : '',
    monthly_rent: lease.rent_amount != null ? String(lease.rent_amount) : '',
    deposit: lease.deposit_amount != null ? String(lease.deposit_amount) : '',
    lease_start_date: lease.start_date ?? '',
    lease_end_date: lease.end_date ?? '',
    rental_due_day: parsed.data.rentalDueDay != null ? String(parsed.data.rentalDueDay) : '',
    annual_escalation: parsed.data.annualEscalationPct != null ? `${parsed.data.annualEscalationPct}%` : '',
    landlord_name: org?.trading_name ?? org?.legal_name ?? '',
    organisation_name: org?.legal_name ?? '',
    approved_occupants: parsed.data.approvedOccupants ?? '',
    parking: parsed.data.parking ?? '',
    utilities: parsed.data.utilities ?? '',
    special_conditions: parsed.data.specialConditions ?? '',
  };

  const templateBuffer = Buffer.from(await templateFile.arrayBuffer());
  const mergeResult = mergeLeaseTemplate(templateBuffer, fields);
  if (!mergeResult.ok) {
    return NextResponse.json(
      {
        error: {
          code: 'lease_merge_failed',
          message: mergeResult.reason,
          missing_fields: mergeResult.missingFields,
        },
      },
      { status: 400 },
    );
  }

  // unit is guaranteed non-null here: property_address/unit_label are REQUIRED_MERGE_FIELDS, so a
  // missing unit/property join would already have returned a 400 above.
  const storagePath = `${lease.org_id}/${unit!.property_id}/${crypto.randomUUID()}.docx`;

  // Server-generated bytes, not a user upload: no scan verdict is recorded for them, so this document
  // can never be sent to OCR without being scanned first.
  const stored = await storeServerGeneratedObject({
    orgId: lease.org_id,
    path: storagePath,
    bytes: mergeResult.buffer,
    contentType: DOCX_MIME,
  });
  if (!stored.ok) {
    return NextResponse.json(
      { error: { code: 'storage_upload_failed', message: stored.error.message } },
      { status: 500 },
    );
  }

  const { data: documentRow, error: versionError } = await createLeaseDocumentVersion(supabase, {
    leaseId: id,
    orgId: lease.org_id,
    kind: 'generated',
    storagePath,
    originalFileName: `${template.name}.docx`,
    mimeType: DOCX_MIME,
    fileSizeBytes: mergeResult.buffer.length,
    templateId: template.id,
    generatedBy: user.id,
  });
  if (versionError) {
    await removeProtectedObjects([storagePath]);
    return NextResponse.json(
      { error: { code: 'lease_document_create_failed', message: versionError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ leaseDocument: mapLeaseDocumentRow(documentRow) }, { status: 201 });
}
