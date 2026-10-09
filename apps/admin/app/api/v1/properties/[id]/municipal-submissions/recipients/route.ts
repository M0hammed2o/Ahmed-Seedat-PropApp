import { NextResponse, type NextRequest } from 'next/server';
import { submissionRecipientCreateSchema } from '@propvault/validation';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { invalidateTemplateApproval } from '@/lib/smartUtility/reporting';
import { canWriteUtilities, forbidden, jsonError, loadReadableProperty, notFound, parseJson, requireUser, serverError } from '@/lib/smartUtility/http';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/properties/:id/municipal-submissions/recipients -- add a recipient. Proplyst only ever
 * emails a reading pack (which contains the municipal account number) to recipients the owner has
 * explicitly authorised (POPIA: a misaddressed pack is an unauthorised disclosure).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, submissionRecipientCreateSchema);
  if ('response' in parsed) return parsed.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!(await canWriteUtilities(auth.supabase, property.org_id, property.id))) return forbidden();

  const now = new Date().toISOString();
  const { data, error } = await auth.supabase
    .from('municipal_submission_recipients')
    .insert({
      org_id: property.org_id,
      property_id: property.id,
      email: parsed.data.email,
      label: parsed.data.label || null,
      recipient_type: parsed.data.recipientType,
      authorised_at: parsed.data.authorise ? now : null,
      authorised_by: parsed.data.authorise ? auth.user.id : null,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return jsonError(409, 'duplicate_recipient', 'That address is already a recipient.');
    return serverError('recipient_create_failed', 'Could not add the recipient.', 'submission_recipients.insert', error);
  }
  // A new authorised recipient changes who receives the pack: approval must be given again.
  const approvalWithdrawn = parsed.data.authorise
    ? await invalidateTemplateApproval(getServiceRoleClient(), {
        propertyId: property.id,
        orgId: property.org_id,
        actorUserId: auth.user.id,
        reason: 'recipient added',
      })
    : false;
  return NextResponse.json({ recipientId: data.id, approvalWithdrawn }, { status: 201 });
}
