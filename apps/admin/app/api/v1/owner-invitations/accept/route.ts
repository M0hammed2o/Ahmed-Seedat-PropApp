import { NextResponse, type NextRequest } from 'next/server';
import { ownerInvitationAcceptSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';

/**
 * POST /api/v1/owner-invitations/accept (shared-access architecture pass, WORKLOG.md this date)
 * -- mirrors /api/v1/tenant-invitations/accept exactly. Requires an authenticated caller (any
 * signed-in user); thin wrapper over accept_owner_invitation(), which does all real validation.
 * Never discloses which specific check failed beyond the generic error_code.
 */
export async function POST(request: NextRequest) {
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

  const limitedByUser = await rateLimitOrRespond(
    supabase,
    `owner-invitation-accept:user:${user.id}`,
    15,
    60,
  );
  if (limitedByUser) return limitedByUser;
  const limitedByIp = await rateLimitOrRespond(
    supabase,
    `owner-invitation-accept:ip:${resolveTrustedClientIp(request)}`,
    30,
    60,
  );
  if (limitedByIp) return limitedByIp;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = ownerInvitationAcceptSchema.safeParse(body);
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

  const { data, error } = await supabase.rpc('accept_owner_invitation', {
    p_token: parsed.data.token,
  });
  if (error) {
    return NextResponse.json(
      { error: { code: 'owner_invitation_accept_failed', message: error.message } },
      { status: 500 },
    );
  }

  const result = data?.[0];
  if (!result || !result.success) {
    return NextResponse.json(
      {
        error: {
          code: result?.error_code ?? 'unknown',
          message:
            ACCEPT_ERROR_MESSAGES[result?.error_code as string] ??
            'This invitation could not be accepted.',
        },
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ownerId: result.owner_id });
}

const ACCEPT_ERROR_MESSAGES: Record<string, string> = {
  not_found: 'This invitation link is invalid.',
  revoked: 'This invitation has been revoked. Ask the property manager to send a new one.',
  expired: 'This invitation has expired. Ask the property manager to send a new one.',
  already_used: 'This invitation has already been used.',
  org_inactive: 'This organization is no longer active.',
  already_linked:
    'This owner record is already linked to a different account. Contact the property manager.',
  email_mismatch: 'This invitation does not match your account email. Contact the property manager.',
};
