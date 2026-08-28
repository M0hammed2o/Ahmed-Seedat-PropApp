import { NextResponse, type NextRequest } from 'next/server';
import { applicationDocumentRequirementReviewSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';

type RouteParams = { params: Promise<{ id: string; requirementId: string }> };

/**
 * PATCH /api/v1/applications/:id/document-requirements/:requirementId (launch-hardening pass,
 * WORKLOG.md 2026-08-26, Section 3). Staff review action on an uploaded applicant document --
 * "Accept" (marks the requirement's authoritative fields as usable) or "Needs correction"
 * (rejected, with a reason, so the applicant sees why on the portal). RLS
 * (application_document_requirements_update_staff, migration 20260101000132) already enforces
 * agent+/property-access; this route does not duplicate that check.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id, requirementId } = await params;
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
  const parsed = applicationDocumentRequirementReviewSchema.safeParse(body);
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

  const { data: existing, error: fetchError } = await supabase
    .from('application_document_requirements')
    .select('id, application_id, requirement_key, status, document_id')
    .eq('id', requirementId)
    .eq('application_id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'requirement_fetch_failed', message: 'Could not load this document requirement.' } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Document requirement not found.' } },
      { status: 404 },
    );
  }
  if (!existing.document_id) {
    return NextResponse.json(
      { error: { code: 'no_document', message: 'Nothing has been uploaded for this requirement yet.' } },
      { status: 409 },
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from('application_document_requirements')
    .update({
      status: parsed.data.status,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: parsed.data.status === 'rejected' ? (parsed.data.rejectionReason ?? null) : null,
    })
    .eq('id', requirementId)
    .select('org_id')
    .single();
  if (updateError) {
    return NextResponse.json(
      { error: { code: 'requirement_update_failed', message: 'Could not update this document requirement.' } },
      { status: 500 },
    );
  }

  await writeAuditEvent(getServiceRoleClient(), {
    orgId: updated.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: parsed.data.status === 'accepted' ? 'application.document_accepted' : 'application.document_reviewed',
    entityType: 'application_document_requirements',
    entityId: requirementId,
    after: { requirementKey: existing.requirement_key, status: parsed.data.status },
  });

  return NextResponse.json({ ok: true });
}
