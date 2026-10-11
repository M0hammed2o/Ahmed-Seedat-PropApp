import { NextResponse, type NextRequest } from 'next/server';
import { submissionActionSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';
import { canWriteUtilities, forbidden, jsonError, notFound, parseJson, requireUser, serverError, utilitiesDisabled, utilitiesEnabledForOrg } from '@/lib/smartUtility/http';
import {
  approveSubmission,
  recordAcceptance,
  sendDueDeliveries,
  SubmissionStateError,
} from '@/lib/smartUtility/submissions';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/municipal-submissions/:id
 *   {action:'approve'}   → approve and queue delivery to authorised recipients, then send now
 *   {action:'send'}      → (re)send due deliveries now (e.g. after fixing a recipient)
 *   {action:'cancel'}    → cancel a pack that has not been sent
 *   {action:'acceptance', acceptanceStatus, reference?, notes?} → record what the municipality did.
 * Sent ≠ accepted: acceptance is only ever set here, by a person.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, submissionActionSchema);
  if ('response' in parsed) return parsed.response;
  const { data: sub } = await auth.supabase
    .from('municipal_submissions')
    .select('id, org_id, property_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!sub) return notFound('Submission');
  if (!(await canWriteUtilities(auth.supabase, sub.org_id, sub.property_id))) return forbidden();
  if (!(await utilitiesEnabledForOrg(sub.org_id))) return utilitiesDisabled();

  const service = getServiceRoleClient();
  try {
    switch (parsed.data.action) {
      case 'approve': {
        const { deliveries } = await approveSubmission(service, { submissionId: id, actorUserId: auth.user.id });
        const sent = await sendDueDeliveries(service, { submissionId: id });
        return NextResponse.json({ status: 'scheduled', deliveries, send: sent });
      }
      case 'send': {
        if (!['approved', 'scheduled', 'sending', 'partially_failed', 'failed'].includes(sub.status)) {
          return jsonError(409, 'not_approved', 'Approve the reading pack before sending it.');
        }
        // A manual resend makes failed deliveries due immediately (attempt limit still applies).
        await service
          .from('municipal_submission_deliveries')
          .update({ next_attempt_at: new Date().toISOString() })
          .eq('submission_id', id)
          .eq('status', 'failed');
        const sent = await sendDueDeliveries(service, { submissionId: id });
        return NextResponse.json({ send: sent });
      }
      case 'cancel': {
        if (!['draft', 'pending_approval', 'approved', 'scheduled'].includes(sub.status)) {
          return jsonError(409, 'cannot_cancel', 'Only an unsent reading pack can be cancelled.');
        }
        await service.from('municipal_submissions').update({ status: 'cancelled' }).eq('id', id);
        await service.from('municipal_submission_deliveries').delete().eq('submission_id', id).eq('status', 'pending');
        await writeAuditEvent(service, {
          orgId: sub.org_id,
          actorUserId: auth.user.id,
          actorType: 'user',
          action: 'municipal_submission.cancelled',
          entityType: 'municipal_submissions',
          entityId: id,
        });
        return NextResponse.json({ status: 'cancelled' });
      }
      case 'acceptance': {
        await recordAcceptance(service, {
          submissionId: id,
          actorUserId: auth.user.id,
          acceptanceStatus: parsed.data.acceptanceStatus,
          reference: parsed.data.reference,
          notes: parsed.data.notes,
        });
        return NextResponse.json({ acceptanceStatus: parsed.data.acceptanceStatus });
      }
    }
  } catch (error) {
    if (error instanceof SubmissionStateError) return jsonError(409, 'invalid_state', error.message);
    return serverError('submission_action_failed', 'Could not complete that action.', 'municipal_submissions.action', error);
  }
}
