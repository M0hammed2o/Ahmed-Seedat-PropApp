import { NextResponse, type NextRequest } from 'next/server';
import { municipalTemplateApprovalSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';
import { buildPreview } from '@/lib/smartUtility/preview';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/properties/:id/municipal-submissions/approve-template {templateHash} — the owner
 * approves exactly the preview they saw: the hash they send must equal the server's hash of the
 * saved template + fields + CC + authorised recipients, otherwise 409 (something changed since the
 * preview). The approved preview (recipients, subject, body, attachment names) is audited.
 * DELETE withdraws approval (and switches scheduled sending off).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, municipalTemplateApprovalSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const service = getServiceRoleClient();
  try {
    const p = await buildPreview(service, property.id, null);
    if (p.hash !== parsed.data.templateHash) {
      return jsonError(409, 'preview_outdated', 'The email changed since you previewed it. Preview it again before approving.');
    }
    if (p.rendered.to.length === 0) {
      return jsonError(409, 'no_authorised_recipients', 'Add and authorise at least one recipient before approving.');
    }
    const now = new Date().toISOString();
    const { data, error } = await service
      .from('municipal_submission_settings')
      .update({ template_hash: p.hash, template_approved_at: now, template_approved_by: auth.user.id })
      .eq('property_id', property.id)
      .select('id')
      .single();
    if (error || !data) return serverError('approve_failed', 'Save the settings first, then approve.', 'municipal_template.approve', error ?? new Error('no settings'));
    await writeAuditEvent(service, {
      orgId: property.org_id,
      actorUserId: auth.user.id,
      actorType: 'user',
      action: 'municipal_template.approved',
      entityType: 'municipal_submission_settings',
      entityId: data.id,
      after: {
        templateHash: p.hash,
        to: p.rendered.to,
        cc: p.rendered.cc,
        subject: p.rendered.subject,
        bodyText: p.rendered.bodyText,
        attachments: p.rendered.attachments.map((x) => x.filename),
      },
    });
    return NextResponse.json({ approved: true, templateHash: p.hash, approvedAt: now });
  } catch (error) {
    return serverError('approve_failed', 'Could not approve the template.', 'municipal_template.approve', error);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();
  const service = getServiceRoleClient();
  await service
    .from('municipal_submission_settings')
    .update({ template_hash: null, template_approved_at: null, template_approved_by: null, schedule_enabled: false })
    .eq('property_id', property.id);
  await writeAuditEvent(service, {
    orgId: property.org_id,
    actorUserId: auth.user.id,
    actorType: 'user',
    action: 'municipal_template.approval_withdrawn',
    entityType: 'properties',
    entityId: property.id,
    after: { reason: 'withdrawn by user' },
  });
  return NextResponse.json({ approved: false });
}
