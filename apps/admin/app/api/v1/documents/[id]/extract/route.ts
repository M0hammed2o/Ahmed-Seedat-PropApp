import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { getDocumentIntelligenceProvider } from '@/lib/providers/documentIntelligence';
import { mapExtractionResultRow } from '@/lib/documents';

type RouteParams = { params: Promise<{ id: string }> };

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes -- matches GET /api/v1/documents/:id's own TTL

// Same two document types apps/admin/lib/providers/documentIntelligence.ts's extractFields()
// actually returns meaningful fields for (bill/lease) -- other types would just get the generic
// bill-shaped fallback, which would be misleading to show as "extracted" data.
const SUPPORTED_TYPES = new Set(['bill', 'lease']);

/**
 * POST /api/v1/documents/:id/extract (API_SPEC.md §7 OCR review workflow, TASKS.md M20).
 * Generalizes the pattern POST /api/v1/leases/:id/upload-and-parse already proved out in M12:
 * extraction_jobs/extraction_results have no client write policy at all (server-side pipeline
 * only), so this route -- after requireOrgRole() authorizes the caller on the session-bound
 * client -- switches to the service-role client for exactly those two tables.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id, org_id, document_type, storage_path, mime_type')
    .eq('id', id)
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
  if (!document.org_id) {
    return NextResponse.json(
      { error: { code: 'not_org_scoped', message: 'This document predates org-scoping and cannot be processed here.' } },
      { status: 400 },
    );
  }

  const canWrite = await requireOrgRole(supabase, document.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to process this document.' } },
      { status: 403 },
    );
  }

  if (!SUPPORTED_TYPES.has(document.document_type)) {
    return NextResponse.json(
      {
        error: {
          code: 'extraction_not_supported',
          message: `Field extraction is only available for bill or lease documents (this document is "${document.document_type}").`,
        },
      },
      { status: 400 },
    );
  }

  const serviceRole = getServiceRoleClient();

  const { data: job, error: jobError } = await serviceRole
    .from('extraction_jobs')
    .insert({ document_id: document.id, org_id: document.org_id, status: 'processing' })
    .select('id')
    .single();
  if (jobError) {
    return NextResponse.json(
      { error: { code: 'extraction_job_create_failed', message: jobError.message } },
      { status: 500 },
    );
  }

  const { data: signedUrlData, error: signedUrlError } = await serviceRole.storage
    .from('documents')
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return NextResponse.json(
      { error: { code: 'signed_url_failed', message: signedUrlError?.message ?? 'Could not create a signed URL for this document.' } },
      { status: 500 },
    );
  }

  const provider = getDocumentIntelligenceProvider();
  const processingInput = {
    documentId: document.id,
    storagePath: document.storage_path,
    mimeType: document.mime_type,
    signedUrl: signedUrlData.signedUrl,
  };

  try {
    const extraction = await provider.extractFields(processingInput, document.document_type as 'bill' | 'lease');

    const { data: resultRow, error: resultError } = await serviceRole
      .from('extraction_results')
      .insert({
        extraction_job_id: job.id,
        org_id: document.org_id,
        raw_provider_output: extraction,
        overall_confidence: extraction.overallConfidence,
      })
      .select('*')
      .single();
    if (resultError) throw new Error(resultError.message);

    await serviceRole.from('extraction_jobs').update({ status: 'succeeded' }).eq('id', job.id);

    return NextResponse.json({ extractionResult: mapExtractionResultRow(resultRow), extractionJobId: job.id });
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
