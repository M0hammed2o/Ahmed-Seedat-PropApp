import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { canUseOcr } from '@/lib/subscriptionEntitlements';
import { getDocumentIntelligenceProvider } from '@/lib/providers/documentIntelligence';

type RouteParams = { params: Promise<{ id: string }> };

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes -- matches GET /api/v1/documents/:id's own TTL

// First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 13: exactly one of
// documentId (legacy -- the general `documents` table, still supported unchanged) or
// leaseDocumentId (new -- lease_documents, Phase N/migration 20260101000134's manual-upload/
// generated version history) must be provided. Lets the new lease-preparation UI reuse this same
// OCR pipeline for a manually uploaded completed lease without requiring a parallel `documents` row
// to exist for it.
const uploadAndParseSchema = z
  .object({
    documentId: z.string().uuid('documentId must be a valid UUID').optional(),
    leaseDocumentId: z.string().uuid('leaseDocumentId must be a valid UUID').optional(),
  })
  .refine((v) => (v.documentId ? !v.leaseDocumentId : Boolean(v.leaseDocumentId)), {
    message: 'Provide exactly one of documentId or leaseDocumentId',
    path: ['documentId'],
  });

/**
 * POST /api/v1/leases/:id/upload-and-parse (API_SPEC.md §4: "PDF -> OCR -> prefilled lease
 * review"). Deferred from M10 pending M12's DocumentIntelligenceProvider lease support -- now
 * built (apps/admin/lib/providers/documentIntelligence.ts).
 *
 * Takes an already-uploaded document's id (the client inserts the `documents` row + storage
 * object directly, a plain RLS-protected write per API_SPEC.md §0 -- no dedicated
 * `POST /api/v1/documents` route exists yet, M11 scoped that out) rather than accepting a file
 * upload itself, keeping this endpoint's one job just the OCR call. Returns extracted fields for
 * client-side review only -- never writes them onto the lease directly, matching
 * DOCUMENT_INTELLIGENCE.md's "customer always sees extracted fields in an editable confirmation
 * screen before they're treated as final" rule. The client confirms via the existing
 * `PATCH /api/v1/leases/:id`.
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
    .select('id, org_id')
    .eq('id', id)
    .maybeSingle();
  if (leaseError) {
    return NextResponse.json(
      { error: { code: 'lease_fetch_failed', message: leaseError.message } },
      { status: 500 },
    );
  }
  if (!lease) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Lease not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, lease.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to parse documents for this lease.',
        },
      },
      { status: 403 },
    );
  }

  // RELEASE A P0 fix: OCR is a real, gated commercial differentiator (feature_limits.ocrEnabled)
  // that was previously readable but never enforced anywhere.
  if (!(await canUseOcr(supabase, lease.org_id))) {
    return NextResponse.json(
      {
        error: {
          code: 'feature_not_available',
          message: 'Document scanning (OCR) is not included in your current plan.',
          upgradeRequired: true,
        },
      },
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

  const parsed = uploadAndParseSchema.safeParse(body);
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

  let document: { id: string; org_id: string; storage_path: string; mime_type: string } | null = null;
  if (parsed.data.documentId) {
    const { data, error: documentError } = await supabase
      .from('documents')
      .select('id, org_id, storage_path, mime_type')
      .eq('id', parsed.data.documentId)
      .maybeSingle();
    if (documentError) {
      return NextResponse.json(
        { error: { code: 'document_fetch_failed', message: documentError.message } },
        { status: 500 },
      );
    }
    document = data;
  } else {
    const { data, error: documentError } = await supabase
      .from('lease_documents')
      .select('id, org_id, lease_id, storage_path, mime_type')
      .eq('id', parsed.data.leaseDocumentId)
      .maybeSingle();
    if (documentError) {
      return NextResponse.json(
        { error: { code: 'document_fetch_failed', message: documentError.message } },
        { status: 500 },
      );
    }
    if (data && data.lease_id !== id) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Document not found.' } },
        { status: 404 },
      );
    }
    document = data;
  }
  if (!document) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Document not found.' } },
      { status: 404 },
    );
  }
  // Same cross-org guard reasoning as property_owners (M7) / payment_matches (M11): a document
  // and a lease can each independently pass RLS while belonging to different orgs.
  if (document.org_id !== lease.org_id) {
    return NextResponse.json(
      {
        error: {
          code: 'org_mismatch',
          message: 'The document and the lease must belong to the same organization.',
        },
      },
      { status: 400 },
    );
  }

  // extraction_jobs/extraction_results have no client INSERT/UPDATE policy at all, by original
  // design (supabase/migrations/20260101000011: "jobs are created and progressed only by the
  // server-side processing pipeline (service-role), never by the mobile/admin client directly").
  // Verified live before shipping this route: an authenticated agent's INSERT into
  // extraction_jobs is rejected with "new row violates row-level security policy" -- this route
  // IS that server-side pipeline, so it uses the service-role client for these two tables
  // specifically, only after requireOrgRole() has already authorized the caller above. Every
  // other read/write in this route stays on the session-bound client.
  const serviceRole = getServiceRoleClient();

  const { data: job, error: jobError } = await serviceRole
    .from('extraction_jobs')
    .insert({ document_id: document.id, org_id: lease.org_id, status: 'processing' })
    .select('id')
    .single();
  if (jobError) {
    return NextResponse.json(
      { error: { code: 'extraction_job_create_failed', message: jobError.message } },
      { status: 500 },
    );
  }

  const provider = getDocumentIntelligenceProvider();
  // Signed URL, not a raw storage path -- so a real provider (AWSTextractDocumentIntelligenceProvider)
  // can fetch the file's bytes itself without this route handing it a Supabase client of its own
  // (see ProcessingInput's own comment). Short TTL matches every other signed-URL issuance in this
  // codebase; the provider call below happens well within it.
  const { data: signedUrlData, error: signedUrlError } = await serviceRole.storage
    .from('documents')
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return NextResponse.json(
      {
        error: {
          code: 'signed_url_failed',
          message: signedUrlError?.message ?? 'Could not create a signed URL for this document.',
        },
      },
      { status: 500 },
    );
  }
  const processingInput = {
    documentId: document.id,
    storagePath: document.storage_path,
    mimeType: document.mime_type,
    signedUrl: signedUrlData.signedUrl,
  };

  try {
    const extraction = await provider.extractFields(processingInput, 'lease');

    await serviceRole.from('extraction_results').insert({
      extraction_job_id: job.id,
      org_id: lease.org_id,
      raw_provider_output: extraction,
      overall_confidence: extraction.overallConfidence,
      provider_name: provider.providerName,
    });

    await serviceRole
      .from('extraction_jobs')
      .update({ status: 'succeeded', provider_name: provider.providerName })
      .eq('id', job.id);

    return NextResponse.json({ extraction, extractionJobId: job.id });
  } catch (err) {
    await serviceRole
      .from('extraction_jobs')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        provider_name: provider.providerName,
      })
      .eq('id', job.id);

    return NextResponse.json(
      { error: { code: 'extraction_failed', message: 'Document parsing failed.' } },
      { status: 502 },
    );
  }
}
