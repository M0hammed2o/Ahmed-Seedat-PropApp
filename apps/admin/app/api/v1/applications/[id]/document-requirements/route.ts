import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ id: string }> };

/** GET /api/v1/applications/:id/document-requirements -- staff view of the checklist (Phase 12,
 * extended launch-hardening pass WORKLOG.md 2026-08-26 Section 3: the panel previously only
 * showed a bare status word with no way to view the uploaded file, when it was uploaded, or any
 * OCR result -- the entire staff-facing document review experience was effectively missing).
 * Plain RLS-protected select (application_document_requirements_select_staff, migration
 * 20260101000132) -- no service-role needed, this is an ordinary in-org staff read. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
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

  const { data, error } = await supabase
    .from('application_document_requirements')
    .select(
      'id, requirement_key, label, is_required, status, rejection_reason, document_id, reviewed_at, ' +
        'documents(original_file_name, mime_type, created_at)',
    )
    .eq('application_id', id)
    .order('created_at', { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: { code: 'requirements_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    requirement_key: string;
    label: string;
    is_required: boolean;
    status: string;
    rejection_reason: string | null;
    document_id: string | null;
    reviewed_at: string | null;
    documents: { original_file_name: string; mime_type: string; created_at: string } | null;
  }>;

  // OCR summary, one lookup per requirement that actually has a document -- most applications
  // have 3-4 requirements, so this stays a handful of small indexed queries, not an N+1 concern
  // at the scale this table sees.
  const requirements = await Promise.all(
    rows.map(async (r) => {
      let ocr: { overallConfidence: number; fieldCount: number; reviewedAt: string | null } | null = null;
      if (r.document_id) {
        const { data: job } = await supabase
          .from('extraction_jobs')
          .select('id')
          .eq('document_id', r.document_id)
          .eq('status', 'succeeded')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (job) {
          const { data: result } = await supabase
            .from('extraction_results')
            .select('raw_provider_output, overall_confidence, reviewed_at')
            .eq('extraction_job_id', job.id)
            .maybeSingle();
          if (result) {
            const fields = result.raw_provider_output as Record<string, unknown>;
            const fieldCount = Object.entries(fields ?? {}).filter(
              ([key, val]) =>
                key !== 'overallConfidence' &&
                key !== 'metadata' &&
                val &&
                typeof val === 'object' &&
                'value' in (val as object),
            ).length;
            ocr = {
              overallConfidence: result.overall_confidence,
              fieldCount,
              reviewedAt: result.reviewed_at,
            };
          }
        }
      }
      return {
        id: r.id,
        requirementKey: r.requirement_key,
        label: r.label,
        isRequired: r.is_required,
        status: r.status,
        rejectionReason: r.rejection_reason,
        documentId: r.document_id,
        uploadedAt: r.documents?.created_at ?? null,
        originalFileName: r.documents?.original_file_name ?? null,
        reviewedAt: r.reviewed_at,
        ocr,
      };
    }),
  );

  return NextResponse.json({ requirements });
}
