import { NextResponse, type NextRequest } from 'next/server';
import { submissionRecipientUpdateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { invalidateTemplateApproval } from '@/lib/smartUtility/reporting';
import { canWriteUtilities, forbidden, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

/** PATCH /api/v1/municipal-submission-recipients/:id -- (de)activate, authorise/withdraw, relabel. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, submissionRecipientUpdateSchema);
  if ('response' in parsed) return parsed.response;
  const { data: recipient } = await auth.supabase
    .from('municipal_submission_recipients')
    .select('id, org_id, property_id')
    .eq('id', id)
    .maybeSingle();
  if (!recipient) return notFound('Recipient');
  if (!(await canWriteUtilities(auth.supabase, recipient.org_id, recipient.property_id))) return forbidden();

  const update: Record<string, unknown> = {};
  if (parsed.data.active !== undefined) update.active = parsed.data.active;
  if (parsed.data.label !== undefined) update.label = parsed.data.label || null;
  if (parsed.data.authorise !== undefined) {
    update.authorised_at = parsed.data.authorise ? new Date().toISOString() : null;
    update.authorised_by = parsed.data.authorise ? auth.user.id : null;
  }
  const { error } = await auth.supabase.from('municipal_submission_recipients').update(update).eq('id', id);
  if (error) return serverError('recipient_update_failed', 'Could not update the recipient.', 'submission_recipients.update', error);
  const approvalWithdrawn =
    parsed.data.active !== undefined || parsed.data.authorise !== undefined
      ? await invalidateTemplateApproval(getServiceRoleClient(), {
          propertyId: recipient.property_id,
          orgId: recipient.org_id,
          actorUserId: auth.user.id,
          reason: 'recipients changed',
        })
      : false;
  return NextResponse.json({ updated: true, approvalWithdrawn });
}
