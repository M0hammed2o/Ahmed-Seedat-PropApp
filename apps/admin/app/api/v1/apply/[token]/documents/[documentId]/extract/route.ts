import { NextResponse, type NextRequest } from 'next/server';
import type { DocumentType } from '@propvault/types';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { canUseOcr } from '@/lib/subscriptionEntitlements';
import { getDocumentIntelligenceProvider } from '@/lib/providers/documentIntelligence';
import { mapExtractionResultRow } from '@/lib/documents';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ token: string; documentId: string }> };

const SIGNED_URL_TTL_SECONDS = 300;
const SUPPORTED_TYPES = new Set(['id_document', 'proof_of_address', 'payslip', 'bank_statement']);
const MAX_ATTEMPTS = 3;

/**
 * POST /api/v1/apply/:token/documents/:documentId/extract (Phase 1/5, first-tenant-workflow
 * predeploy pass). Public, token-scoped -- validates the token AND that the document actually
 * belongs to this exact application before ever touching extraction_jobs/extraction_results
 * (service-role only, no client write policy exists on either table -- same posture the staff
 * extract route already established).
 *
 * Idempotent: a document with an already-succeeded extraction returns that result unchanged,
 * never re-runs OCR (Phase 5 "page refresh -> does not rerun completed OCR" /
 * "same document -> no unlimited OCR jobs"). A previously-failed attempt may retry, capped at
 * MAX_ATTEMPTS so a broken document can't spin indefinitely.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { token, documentId } = await params;
  const supabase = await getServerSupabaseClient();

  const { data: appData, error: appError } = await supabase
    .rpc('get_application_by_token', { p_token: token })
    .single();
  if (appError) {
    return NextResponse.json(
      { error: { code: 'application_lookup_failed', message: appError.message } },
      { status: 500 },
    );
  }
  const app = appData as { valid: boolean; error_code: string | null; application_id: string | null; org_id: string | null };
  if (!app.valid || !app.application_id || !app.org_id) {
    return NextResponse.json(
      { error: { code: app.error_code ?? 'invalid_token', message: 'This link is no longer valid.' } },
      { status: 410 },
    );
  }

  const serviceRole = getServiceRoleClient();

  const { data: document } = await serviceRole
    .from('documents')
    .select('id, org_id, application_id, document_type, storage_path, mime_type')
    .eq('id', documentId)
    .maybeSingle();
  if (!document || document.application_id !== app.application_id) {
    // Deliberately the same 404 whether the document doesn't exist or belongs to a different
    // application -- never confirms/denies another application's document exists.
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Document not found.' } },
      { status: 404 },
    );
  }
  if (!SUPPORTED_TYPES.has(document.document_type)) {
    return NextResponse.json(
      { error: { code: 'extraction_not_supported', message: 'This document type does not support OCR.' } },
      { status: 400 },
    );
  }

  if (!(await canUseOcr(serviceRole, document.org_id))) {
    return NextResponse.json(
      {
        error: {
          code: 'feature_not_available',
          message: 'Document scanning (OCR) is not included in this organization\'s current plan.',
        },
      },
      { status: 403 },
    );
  }

  // Idempotency: an already-succeeded extraction for this document is returned unchanged.
  const { data: existingJobs } = await serviceRole
    .from('extraction_jobs')
    .select('id, status, attempt')
    .eq('document_id', documentId)
    .order('attempt', { ascending: false });
  const succeededJob = (existingJobs ?? []).find((j) => j.status === 'succeeded');
  if (succeededJob) {
    const { data: existingResult } = await serviceRole
      .from('extraction_results')
      .select('*')
      .eq('extraction_job_id', succeededJob.id)
      .maybeSingle();
    if (existingResult) {
      return NextResponse.json({
        extractionResult: mapExtractionResultRow(existingResult),
        extractionJobId: succeededJob.id,
        reused: true,
      });
    }
  }

  const attempt = (existingJobs ?? []).reduce((max, j) => Math.max(max, j.attempt), 0) + 1;
  if (attempt > MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: { code: 'max_attempts_exceeded', message: 'This document could not be processed after several attempts.' } },
      { status: 409 },
    );
  }

  const { data: job, error: jobError } = await serviceRole
    .from('extraction_jobs')
    .insert({ document_id: documentId, org_id: document.org_id, status: 'processing', attempt })
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
      { error: { code: 'signed_url_failed', message: signedUrlError?.message ?? 'Could not create a signed URL.' } },
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
    const extraction = await provider.extractFields(processingInput, document.document_type as DocumentType);

    const { data: resultRow, error: resultError } = await serviceRole
      .from('extraction_results')
      .insert({
        extraction_job_id: job.id,
        org_id: document.org_id,
        raw_provider_output: extraction,
        overall_confidence: extraction.overallConfidence,
        provider_name: provider.providerName,
      })
      .select('*')
      .single();
    if (resultError) throw new Error(resultError.message);

    await serviceRole
      .from('extraction_jobs')
      .update({ status: 'succeeded', provider_name: provider.providerName })
      .eq('id', job.id);

    // actor_type 'system' -- no real auth.users identity exists for an applicant. tokenId in the
    // payload (never the token itself) is how a reviewer distinguishes this from a genuine
    // cron/system action, same convention every other applicant-token RPC/route already follows.
    await writeAuditEvent(serviceRole, {
      orgId: document.org_id,
      actorUserId: null,
      actorType: 'system',
      action: 'application.ocr_processed',
      entityType: 'extraction_jobs',
      entityId: job.id,
      after: { documentId, overallConfidence: extraction.overallConfidence },
    });

    return NextResponse.json({
      extractionResult: mapExtractionResultRow(resultRow),
      extractionJobId: job.id,
      reused: false,
    });
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
      { error: { code: 'extraction_failed', message: 'Document parsing failed. You can try again.' } },
      { status: 502 },
    );
  }
}
