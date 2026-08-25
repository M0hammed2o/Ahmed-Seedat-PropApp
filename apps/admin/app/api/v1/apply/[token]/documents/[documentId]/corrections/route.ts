import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ token: string; documentId: string }> };

const correctionsSchema = z.object({
  correctedFields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
});

/**
 * POST /api/v1/apply/:token/documents/:documentId/corrections (Phase 2/3, first-tenant-workflow
 * predeploy pass). Records which OCR-suggested fields a human corrected, purely for traceability/
 * QA (Phase 4's "does this reduce manual capture" measurement) -- this is NEVER a write path to
 * applications/tenants/leases; those stay exclusively driven by the applicant's own submit action.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token, documentId } = await params;
  const supabase = await getServerSupabaseClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }
  const parsed = correctionsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Check the highlighted fields.' } },
      { status: 400 },
    );
  }

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
    .select('id, application_id')
    .eq('id', documentId)
    .maybeSingle();
  if (!document || document.application_id !== app.application_id) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Document not found.' } }, { status: 404 });
  }

  const { data: job } = await serviceRole
    .from('extraction_jobs')
    .select('id')
    .eq('document_id', documentId)
    .eq('status', 'succeeded')
    .order('attempt', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!job) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'No completed OCR extraction exists for this document yet.' } },
      { status: 404 },
    );
  }

  const { data: result, error: updateError } = await serviceRole
    .from('extraction_results')
    .update({ corrected_fields: parsed.data.correctedFields, reviewed_at: new Date().toISOString() })
    .eq('extraction_job_id', job.id)
    .select('id')
    .maybeSingle();
  if (updateError) {
    return NextResponse.json(
      { error: { code: 'corrections_save_failed', message: updateError.message } },
      { status: 500 },
    );
  }

  await writeAuditEvent(serviceRole, {
    orgId: app.org_id,
    actorUserId: null,
    actorType: 'system',
    action: 'application.ocr_corrected',
    entityType: 'extraction_results',
    entityId: result?.id ?? job.id,
    after: { documentId, correctedFieldCount: Object.keys(parsed.data.correctedFields).length },
  });

  return NextResponse.json({ success: true });
}
