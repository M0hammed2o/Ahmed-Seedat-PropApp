import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { canUseOcr } from '@/lib/subscriptionEntitlements';
import { getDocumentIntelligenceProvider } from '@/lib/providers/documentIntelligence';
import { parseLevyStatementLineItems } from '@/lib/levyStatementParsing';
import { writeAuditEvent } from '@/lib/audit';

const SIGNED_URL_TTL_SECONDS = 300; // matches GET /api/v1/documents/:id and .../documents/:id/extract

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/levy-statements/:id/extract (PHASE 10/11). Reuses the existing
 * DocumentIntelligenceProvider (extractText() -- raw OCR, generic across every provider, no
 * document-type branching) and extraction_jobs/extraction_results for provenance, exactly like
 * POST /api/v1/documents/:id/extract already does for bills/leases. Line items are then produced
 * by a disclosed HEURISTIC parser (lib/levyStatementParsing.ts), not a native provider feature --
 * every resulting row is written with source: 'ocr_heuristic' and a low, fixed confidence,
 * requiring human review (PUT .../line-items, then POST .../review) before anything is treated as
 * final. Never posts to accounting.
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

  const { data: statement } = await supabase
    .from('levy_statements')
    .select('id, org_id, document_id')
    .eq('id', id)
    .maybeSingle();
  if (!statement) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Levy statement not found.' } },
      { status: 404 },
    );
  }
  if (!(await requireOrgRole(supabase, statement.org_id, 'agent'))) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to process this statement.',
        },
      },
      { status: 403 },
    );
  }

  // RELEASE A P0 fix: OCR is a real, gated commercial differentiator (feature_limits.ocrEnabled)
  // that was previously readable but never enforced anywhere.
  if (!(await canUseOcr(supabase, statement.org_id))) {
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

  const { data: document } = await serviceRole
    .from('documents')
    .select('storage_path, mime_type')
    .eq('id', statement.document_id)
    .maybeSingle();
  if (!document) {
    return NextResponse.json(
      {
        error: {
          code: 'document_not_found',
          message: 'The underlying document could not be found.',
        },
      },
      { status: 404 },
    );
  }

  const { data: job, error: jobError } = await serviceRole
    .from('extraction_jobs')
    .insert({ document_id: statement.document_id, org_id: statement.org_id, status: 'processing' })
    .select('id')
    .single();
  if (jobError) {
    return NextResponse.json(
      { error: { code: 'extraction_job_create_failed', message: jobError.message } },
      { status: 500 },
    );
  }

  await serviceRole
    .from('levy_statements')
    .update({ status: 'extracting', extraction_job_id: job.id })
    .eq('id', id);

  const { data: signedUrlData, error: signedUrlError } = await serviceRole.storage
    .from('documents')
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signedUrlError || !signedUrlData) {
    await serviceRole
      .from('extraction_jobs')
      .update({ status: 'failed', error_message: signedUrlError?.message ?? 'Signed URL failed' })
      .eq('id', job.id);
    return NextResponse.json(
      {
        error: {
          code: 'signed_url_failed',
          message: 'Could not create a signed URL for this document.',
        },
      },
      { status: 500 },
    );
  }

  // Resolved before the try block (a pure, non-throwing call) so both the success AND failure
  // paths below can record which provider was in use -- infrastructure hardening pass (WORKLOG.md
  // this date): extraction_jobs.provider_name already existed as a column but was never written.
  const provider = getDocumentIntelligenceProvider();

  try {
    const ocrResult = await provider.extractText({
      documentId: statement.document_id,
      storagePath: document.storage_path,
      mimeType: document.mime_type,
      signedUrl: signedUrlData.signedUrl,
    });

    const { error: resultError } = await serviceRole.from('extraction_results').insert({
      extraction_job_id: job.id,
      org_id: statement.org_id,
      raw_provider_output: { rawText: ocrResult.rawText, metadata: ocrResult.metadata },
      overall_confidence: ocrResult.confidence,
      provider_name: provider.providerName,
    });
    if (resultError) throw new Error(resultError.message);

    const parsedItems = parseLevyStatementLineItems(ocrResult.rawText);

    if (parsedItems.length > 0) {
      const { error: lineItemsError } = await serviceRole.from('levy_statement_line_items').insert(
        parsedItems.map((item, index) => ({
          statement_id: id,
          org_id: statement.org_id,
          line_type: item.lineType,
          category: item.category,
          description: item.description,
          amount: item.amount,
          source: 'ocr_heuristic',
          confidence: item.confidence,
          sort_order: index,
        })),
      );
      if (lineItemsError) throw new Error(lineItemsError.message);
    }

    await serviceRole
      .from('extraction_jobs')
      .update({ status: 'succeeded', provider_name: provider.providerName })
      .eq('id', job.id);
    await serviceRole.from('levy_statements').update({ status: 'extracted' }).eq('id', id);

    await writeAuditEvent(serviceRole, {
      orgId: statement.org_id,
      actorUserId: user.id,
      actorType: 'user',
      action: 'levy_statement.extracted',
      entityType: 'levy_statements',
      entityId: id,
      after: { lineItemsFound: parsedItems.length, ocrConfidence: ocrResult.confidence },
    });

    return NextResponse.json({ lineItemsExtracted: parsedItems.length });
  } catch (err) {
    await serviceRole
      .from('extraction_jobs')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        provider_name: provider.providerName,
      })
      .eq('id', job.id);
    await serviceRole.from('levy_statements').update({ status: 'uploaded' }).eq('id', id);

    return NextResponse.json(
      { error: { code: 'extraction_failed', message: 'Statement extraction failed.' } },
      { status: 502 },
    );
  }
}
