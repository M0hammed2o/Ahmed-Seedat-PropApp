import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { writeAuditEvent } from '@/lib/audit';
import { dispatchEmail } from '@/lib/emailDispatch';
import { dispatchApplicationDocumentsRequestedWhatsApp } from '@/lib/applicationNotifications';

type RouteParams = { params: Promise<{ id: string }> };

const requestDocumentsSchema = z.object({
  requirementKeys: z.array(z.string().min(1)).min(1),
  message: z.string().max(1000).optional().nullable(),
});

/**
 * POST /api/v1/applications/:id/request-documents (Phase 12, first-tenant-workflow predeploy
 * pass). Staff asks the applicant to (re-)provide one or more documents -- flips each named
 * requirement's status to 'requested' (with the optional message recorded as its
 * rejection_reason, reused as the "why" field the applicant portal already displays for a
 * requirement in that state) and notifies the applicant.
 *
 * Idempotent by state, not by call count: a requirement already sitting at 'requested' is left
 * untouched by a repeat call with the same key -- re-clicking with the exact same selection sends
 * no second notification and creates no new row, because nothing about that requirement's real
 * state changed. Only requirements that actually transition get notified about.
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

  const { data: application, error: applicationError } = await supabase
    .from('applications')
    .select('org_id, applicant_email, units(unit_label, properties(nickname)), organizations(trading_name, legal_name)')
    .eq('id', id)
    .maybeSingle();
  if (applicationError) {
    return NextResponse.json(
      { error: { code: 'application_fetch_failed', message: applicationError.message } },
      { status: 500 },
    );
  }
  if (!application) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Application not found.' } }, { status: 404 });
  }

  const canWrite = await requireOrgRole(supabase, application.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to manage this application.' } },
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
  const parsed = requestDocumentsSchema.safeParse(body);
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

  const { data: requirements, error: reqError } = await supabase
    .from('application_document_requirements')
    .select('id, requirement_key, status')
    .eq('application_id', id)
    .in('requirement_key', parsed.data.requirementKeys);
  if (reqError) {
    return NextResponse.json(
      { error: { code: 'requirements_fetch_failed', message: reqError.message } },
      { status: 500 },
    );
  }

  const changed: string[] = [];
  for (const req of requirements ?? []) {
    if (req.status === 'requested') continue; // already in the requested state -- no-op
    const { error: updateError } = await supabase
      .from('application_document_requirements')
      .update({ status: 'requested', rejection_reason: parsed.data.message ?? null, document_id: null, updated_at: new Date().toISOString() })
      .eq('id', req.id);
    if (!updateError) changed.push(req.requirement_key);
  }

  if (changed.length === 0) {
    return NextResponse.json({ requested: [] });
  }

  const serviceClient = getServiceRoleClient();
  await writeAuditEvent(serviceClient, {
    orgId: application.org_id,
    actorUserId: user.id,
    actorType: 'user',
    action: 'application.documents_requested',
    entityType: 'applications',
    entityId: id,
    after: { requirementKeys: changed },
  });

  const units = (application as unknown as { units: { unit_label: string; properties: { nickname: string } | null } | null }).units;
  const org = (application as unknown as { organizations: { trading_name: string | null; legal_name: string } | null }).organizations;
  const propertyLabel = units?.properties?.nickname
    ? `${units.properties.nickname} — ${units.unit_label}`
    : (units?.unit_label ?? 'your rental');

  // No portal link is included here -- the plaintext token is only ever revealed once, at
  // issuance (create_application_access_token(), Phase 4), and is never stored or reconstructible
  // afterward. This notification tells the applicant documents are needed; if their original link
  // has expired, staff must explicitly reissue a new one (a separate action) for them to use.

  // A fresh, per-call related-entity id -- deliberately NOT the application id -- so dispatchEmail's
  // own (relatedEntityType, relatedEntityId, templateName) idempotency check never suppresses a
  // genuinely distinct, later "request more documents" round for the same application. Real
  // duplicate-suppression for THIS call is the state-change check above, not this table.
  const dispatchId = crypto.randomUUID();

  if (application.applicant_email) {
    await dispatchEmail(serviceClient, {
      orgId: application.org_id,
      toAddress: application.applicant_email,
      templateName: 'application_documents_requested',
      templateVars: { orgName: org?.trading_name ?? org?.legal_name ?? 'Your landlord', propertyLabel },
      relatedEntityType: 'application_document_requests',
      relatedEntityId: dispatchId,
      actorUserId: user.id,
    });
  }
  await dispatchApplicationDocumentsRequestedWhatsApp(serviceClient, {
    orgId: application.org_id,
    applicationId: id,
    // Same fresh dispatchId the email send above already uses -- a genuine second "request more
    // documents" round for this application must not be silently swallowed by dispatchWhatsApp's
    // already-sent guard keyed on the (unchanged) applicationId (WORKLOG.md 2026-08-27).
    dispatchId,
    propertyLabel,
  });

  return NextResponse.json({ requested: changed });
}
