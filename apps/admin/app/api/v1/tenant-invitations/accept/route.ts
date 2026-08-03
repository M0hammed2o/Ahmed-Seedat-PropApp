import { NextResponse, type NextRequest } from 'next/server';
import { tenantInvitationAcceptSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { rateLimitOrRespond, requestIp } from '@/lib/rateLimit';

/**
 * POST /api/v1/tenant-invitations/accept (PRODUCT DECISION 2, 2026-08-03) -- requires an
 * authenticated caller (any signed-in user; there is no role floor, since this is how a brand
 * new tenant identity gets its first and only grant). Thin wrapper over accept_tenant_invitation()
 * -- the RPC does all real validation; this route's job is auth + rate limiting + shaping the
 * RPC's (success, error_code, tenant_id) result into an HTTP response, never disclosing which
 * specific check failed beyond the generic error_code (no tenant PII in any response here).
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

  // Rate limited by both IP and user id -- a short-code guessing attempt is bounded on two axes
  // (an attacker signed in as themselves trying many codes; the same attacker trying many
  // accounts from one IP), on top of the RPC's own per-invitation failed_attempt_count lockout.
  const limitedByUser = await rateLimitOrRespond(supabase, `tenant-invitation-accept:user:${user.id}`, 15, 60);
  if (limitedByUser) return limitedByUser;
  const limitedByIp = await rateLimitOrRespond(supabase, `tenant-invitation-accept:ip:${requestIp(request)}`, 30, 60);
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

  const parsed = tenantInvitationAcceptSchema.safeParse(body);
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

  const { data, error } = await supabase.rpc('accept_tenant_invitation', {
    p_token: parsed.data.token ?? null,
    p_short_code: parsed.data.shortCode ?? null,
    p_email: parsed.data.email ?? null,
  });
  if (error) {
    return NextResponse.json(
      { error: { code: 'tenant_invitation_accept_failed', message: error.message } },
      { status: 500 },
    );
  }

  const result = data?.[0];
  if (!result || !result.success) {
    return NextResponse.json(
      { error: { code: result?.error_code ?? 'unknown', message: ACCEPT_ERROR_MESSAGES[result?.error_code as string] ?? 'This invitation could not be accepted.' } },
      { status: 400 },
    );
  }

  return NextResponse.json({ tenantId: result.tenant_id });
}

const ACCEPT_ERROR_MESSAGES: Record<string, string> = {
  not_found: 'This invitation link is invalid.',
  invalid_code: 'That code or email doesn’t match. Double-check and try again.',
  locked_out: 'Too many failed attempts. Ask your landlord to send a new invitation.',
  revoked: 'This invitation has been revoked. Ask your landlord to send a new one.',
  expired: 'This invitation has expired. Ask your landlord to send a new one.',
  already_used: 'This invitation has already been used.',
  org_inactive: 'This organization is no longer active.',
  already_linked: 'This tenant record is already linked to a different account. Contact your landlord.',
  email_mismatch: 'This invitation does not match your account email. Contact your landlord.',
};
