import { NextResponse, type NextRequest } from 'next/server';
import { extractionReviewSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole, requirePropertyAccess } from '@/lib/portfolio';
import { mapExtractionResultRow } from '@/lib/documents';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/documents/:id/review (TASKS.md M20 OCR review workflow). A human confirms the
 * most recent extraction is accurate -- sets reviewed_at/reviewed_by only, never rewrites the
 * extracted values (there is no field-correction here by design: correcting-and-applying is each
 * business record's own job, e.g. leases already does this via upload-and-parse + PATCH lease;
 * a generic Documents module has no single business record to apply corrected fields onto).
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

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id, org_id, property_id')
    .eq('id', id)
    .maybeSingle();
  if (documentError) {
    return NextResponse.json(
      { error: { code: 'document_fetch_failed', message: documentError.message } },
      { status: 500 },
    );
  }
  if (!document || !document.org_id) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Document not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, document.org_id, 'agent');
  // Same property-isolation reasoning as /extract -- extraction_results has no client write
  // policy, so this is the only enforcement point for property-level scoping on this action.
  const canAccessProperty =
    canWrite &&
    ((await requirePropertyAccess(supabase, document.property_id, 'property_manager')) ||
      (await requirePropertyAccess(supabase, document.property_id, 'owner')));
  if (!canAccessProperty) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to review this document.',
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

  const parsed = extractionReviewSchema.safeParse(body);
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

  const serviceRole = getServiceRoleClient();

  const { data: latestJob, error: jobError } = await serviceRole
    .from('extraction_jobs')
    .select('id')
    .eq('document_id', id)
    .eq('status', 'succeeded')
    .order('attempt', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jobError) {
    return NextResponse.json(
      { error: { code: 'extraction_job_fetch_failed', message: jobError.message } },
      { status: 500 },
    );
  }
  if (!latestJob) {
    return NextResponse.json(
      {
        error: {
          code: 'no_extraction',
          message: 'This document has no completed extraction to review.',
        },
      },
      { status: 400 },
    );
  }

  const { data, error } = await serviceRole
    .from('extraction_results')
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: user.id })
    .eq('extraction_job_id', latestJob.id)
    .select('*')
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'review_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ extractionResult: mapExtractionResultRow(data) });
}
