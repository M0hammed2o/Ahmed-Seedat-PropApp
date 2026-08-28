import { NextResponse, type NextRequest } from 'next/server';
import type { DocumentType } from '@propvault/types';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole, requirePropertyAccess } from '@/lib/portfolio';
import { canUseOcr } from '@/lib/subscriptionEntitlements';
import { getDocumentIntelligenceProvider } from '@/lib/providers/documentIntelligence';
import { mapExtractionResultRow } from '@/lib/documents';
import { writeAuditEvent } from '@/lib/audit';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ id: string }> };

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes -- matches GET /api/v1/documents/:id's own TTL

// Document types apps/admin/lib/providers/documentIntelligence.ts's extractFields() actually
// returns meaningful fields for -- other types would just get the generic bill-shaped fallback,
// which would be misleading to show as "extracted" data. The 4 applicant types (first-tenant-
// workflow predeploy pass, WORKLOG.md 2026-08-25) let staff also trigger/view OCR on an
// applicant-uploaded document from the ordinary documents UI, not just from the applicant portal's
// own token-scoped route (POST /api/v1/apply/:token/documents/:documentId/extract).
const SUPPORTED_TYPES = new Set([
  'bill',
  'lease',
  'id_document',
  'proof_of_address',
  'payslip',
  'bank_statement',
]);

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
    .select('id, org_id, property_id, document_type, storage_path, mime_type')
    .eq('id', id)
    .maybeSingle();
  if (documentError) {
    return NextResponse.json(
      {
        error: {
          code: 'document_fetch_failed',
          message: safeErrorMessage(
            documentError,
            'Could not load this document. Please try again, or contact support if this continues.',
            `documents.fetch(${id})`,
          ),
        },
      },
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
      {
        error: {
          code: 'not_org_scoped',
          message: 'This document predates org-scoping and cannot be processed here.',
        },
      },
      { status: 400 },
    );
  }

  const canWrite = await requireOrgRole(supabase, document.org_id, 'agent');
  // extraction_jobs/extraction_results have no client write policy at all (this route uses the
  // service-role client for them below) -- unlike an ordinary write to `documents` itself, that
  // write is never independently property-scoped by RLS, so this explicit check is the only
  // enforcement of property isolation for this action (Stage 3: "must be enforced at the
  // backend/database authorization layer", not merely inherited from a table policy that doesn't
  // apply to the tables this route actually writes to).
  const canAccessProperty =
    canWrite &&
    ((await requirePropertyAccess(supabase, document.property_id, 'property_manager')) ||
      (await requirePropertyAccess(supabase, document.property_id, 'owner')));
  if (!canAccessProperty) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to process this document.',
        },
      },
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

  // RELEASE A P0 fix: OCR is a real, gated commercial differentiator (feature_limits.ocrEnabled)
  // that was previously readable but never enforced anywhere.
  if (!(await canUseOcr(supabase, document.org_id))) {
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

  const serviceRole = getServiceRoleClient();

  const { data: job, error: jobError } = await serviceRole
    .from('extraction_jobs')
    .insert({ document_id: document.id, org_id: document.org_id, status: 'processing' })
    .select('id')
    .single();
  if (jobError) {
    return NextResponse.json(
      {
        error: {
          code: 'extraction_job_create_failed',
          message: safeErrorMessage(
            jobError,
            'Could not start document scanning. Please try again, or contact support if this continues.',
            `extraction_jobs.create(${id})`,
          ),
        },
      },
      { status: 500 },
    );
  }

  const { data: signedUrlData, error: signedUrlError } = await serviceRole.storage
    .from('documents')
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    return NextResponse.json(
      {
        error: {
          code: 'signed_url_failed',
          message: signedUrlError
            ? safeErrorMessage(
                signedUrlError,
                'Could not prepare this document for scanning. Please try again, or contact support if this continues.',
                `documents.createSignedUrl(${id})`,
              )
            : 'Could not prepare this document for scanning. Please try again, or contact support if this continues.',
        },
      },
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
    const extraction = await provider.extractFields(
      processingInput,
      document.document_type as DocumentType,
    );

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

    // Phase 15 audit gap (overnight platform pass, WORKLOG.md this date) -- never logs
    // extracted field values (before/after intentionally omit raw_provider_output, same
    // reasoning as POST .../review's audit event) or which vendor ran, since neither is a secret
    // but neither belongs in an audit trail meant for "who did what," not provider diagnostics
    // (that's extraction_jobs.provider_name / extraction_results.provider_name, now actually
    // populated -- infrastructure hardening pass, WORKLOG.md this date -- queryable separately).
    await writeAuditEvent(serviceRole, {
      orgId: document.org_id,
      actorUserId: user.id,
      actorType: 'user',
      action: 'document_extraction.processed',
      entityType: 'extraction_jobs',
      entityId: job.id,
      after: { status: 'succeeded', overallConfidence: extraction.overallConfidence },
    });

    return NextResponse.json({
      extractionResult: mapExtractionResultRow(resultRow),
      extractionJobId: job.id,
    });
  } catch (err) {
    await serviceRole
      .from('extraction_jobs')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        // provider is resolved (a pure, non-throwing call) before this try block, so it's always
        // known here too -- a failure happened calling the provider, not resolving which one to
        // call, so recording which provider failed is real information, not a guess.
        provider_name: provider.providerName,
      })
      .eq('id', job.id);

    return NextResponse.json(
      { error: { code: 'extraction_failed', message: 'Document parsing failed.' } },
      { status: 502 },
    );
  }
}
