import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient } from '@/lib/supabase/server';
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

  const { data: templateFile, error: downloadError } = await supabase.storage
    .from('documents')
    .download(template.storage_path);
  if (downloadError || !templateFile) {
    return NextResponse.json(
      { error: { code: 'template_download_failed', message: downloadError?.message ?? 'Could not read the template file.' } },
      { status: 500 },
    );
  }
  if (template.mime_type !== DOCX_MIME) {
    return NextResponse.json(
      { error: { code: 'unsupported_template_type', message: 'Only DOCX templates can be merged. Use manual upload for PDF templates.' } },
      { status: 400 },
    );
  }

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

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, mergeResult.buffer, { contentType: DOCX_MIME, upsert: false });
  if (uploadError) {
    return NextResponse.json(
      { error: { code: 'storage_upload_failed', message: uploadError.message } },
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
    await supabase.storage.from('documents').remove([storagePath]);
    return NextResponse.json(
      { error: { code: 'lease_document_create_failed', message: versionError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ leaseDocument: mapLeaseDocumentRow(documentRow) }, { status: 201 });
}
