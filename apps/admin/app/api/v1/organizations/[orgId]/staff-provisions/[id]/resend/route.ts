import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { sendActivationLink } from '@/lib/staffProvisioning';

type RouteParams = { params: Promise<{ orgId: string; id: string }> };

/**
 * POST /api/v1/organizations/:orgId/staff-provisions/:id/resend -- re-issues the GoTrue invite
 * link and re-sends the activation email. Valid for a row still 'pending_send_failed' or
 * 'awaiting_activation' (including an expired one -- resending is exactly how a principal recovers
 * from an expired link, matching organization-invites/resend's own "resend keeps working after
 * expiry" precedent). Never valid for an already-'activated' or 'revoked' row.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { orgId, id } = await params;
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

  const canManage = await requireOrgRole(supabase, orgId, 'principal');
  if (!canManage) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to resend this activation.' } },
      { status: 403 },
    );
  }

  const { data: provision, error: fetchError } = await supabase
    .from('organization_staff_provisions')
    .select('id, org_id, email, role, status, resend_count')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'provision_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!provision) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Staff provision not found.' } },
      { status: 404 },
    );
  }
  if (provision.status !== 'pending_send_failed' && provision.status !== 'awaiting_activation') {
    return NextResponse.json(
      {
        error: {
          code: 'provision_not_resendable',
          message:
            provision.status === 'activated'
              ? 'This staff member has already activated their account.'
              : 'This provision is no longer active.',
        },
      },
      { status: 400 },
    );
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('legal_name')
    .eq('id', orgId)
    .maybeSingle();

  const serviceClient = getServiceRoleClient();
  const nextResendCount = provision.resend_count + 1;
  const { error: countError } = await serviceClient
    .from('organization_staff_provisions')
    .update({ resend_count: nextResendCount })
    .eq('id', id);
  if (countError) {
    return NextResponse.json(
      { error: { code: 'resend_count_update_failed', message: countError.message } },
      { status: 500 },
    );
  }

  const result = await sendActivationLink(serviceClient, {
    provisionId: provision.id,
    orgId,
    orgName: org?.legal_name ?? 'your organization',
    email: provision.email,
    role: provision.role,
    actorUserId: user.id,
    dispatchAttempt: nextResendCount,
  });

  return NextResponse.json({
    outcome: result.outcome,
    emailDeliveryConfigured: result.emailDeliveryConfigured,
  });
}
