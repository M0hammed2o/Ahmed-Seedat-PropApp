import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { getDocumentIntelligenceProvider } from '@/lib/providers/documentIntelligence';

type RouteParams = { params: Promise<{ id: string }> };

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes -- matches GET /api/v1/documents/:id's own TTL

const uploadAndParseSchema = z.object({
  documentId: z.string().uuid('documentId must be a valid UUID'),
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
      { error: { code: 'forbidden', message: 'You do not have permission to parse documents for this lease.' } },
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

  const { data: document, error: documentError } = await supabase
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
      { error: { code: 'signed_url_failed', message: signedUrlError?.message ?? 'Could not create a signed URL for this document.' } },
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

    await serviceRole
      .from('extraction_results')
      .insert({ extraction_job_id: job.id, org_id: lease.org_id, raw_provider_output: extraction, overall_confidence: extraction.overallConfidence });

    await serviceRole.from('extraction_jobs').update({ status: 'succeeded' }).eq('id', job.id);

    return NextResponse.json({ extraction, extractionJobId: job.id });
  } catch (err) {
    await serviceRole
      .from('extraction_jobs')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : 'Unknown error' })
      .eq('id', job.id);

    return NextResponse.json(
      { error: { code: 'extraction_failed', message: 'Document parsing failed.' } },
      { status: 502 },
    );
  }
}
