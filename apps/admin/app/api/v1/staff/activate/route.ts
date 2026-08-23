import { NextResponse, type NextRequest } from 'next/server';
import { staffActivateSchema } from '@propvault/validation';
import { RATE_LIMITS } from '@propvault/config';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';

/**
 * POST /api/v1/staff/activate -- the unauthenticated step of the provisioned-staff activation
 * flow: turns a GoTrue `hashed_token` (from `generateLink({type:'invite'})`, see
 * lib/staffProvisioning.ts) into a real session and sets the employee's own password in one call.
 *
 * Retry-safe by design (mirrors app/api/v1/auth/confirm/route.ts's own single-consumption-point
 * discipline, extended one step further): `tokenHash` is only required when no session exists yet.
 * `verifyOtp()` is single-use -- if it succeeds but the follow-up `updateUser({password})` call
 * fails for any reason, the session it established is still valid (the SSR client already wrote
 * the session cookie via this same response), so the client can retry this exact route WITHOUT a
 * tokenHash and this route will skip straight to `updateUser()` using that already-established
 * session. This is what keeps orphan scenario "auth succeeds, follow-up step fails" recoverable
 * without a second token ever needing to exist.
 */
export async function POST(request: NextRequest) {
  const correlationId = crypto.randomUUID();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = staffActivateSchema.safeParse(body);
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

  const serviceClient = getServiceRoleClient();
  const limited = await rateLimitOrRespond(
    serviceClient,
    `staff-activate-ip:${resolveTrustedClientIp(request)}`,
    RATE_LIMITS.staffActivationAttemptsPerMinute,
    60,
  );
  if (limited) return limited;

  const supabase = await getServerSupabaseClient();
  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();

  if (!existingUser) {
    if (!parsed.data.tokenHash) {
      return NextResponse.json(
        {
          error: {
            code: 'missing_token',
            message: 'This activation link is missing its token. Ask your administrator to resend it.',
          },
        },
        { status: 400 },
      );
    }

    // Never log the token itself -- only its outcome, same convention as auth/confirm/route.ts.
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: parsed.data.tokenHash,
      type: 'invite',
    });
    if (verifyError) {
      console.warn('staff_activate_verify_failed', {
        correlationId,
        errorCode: verifyError.code,
        errorStatus: verifyError.status,
      });
      return NextResponse.json(
        {
          error: {
            code: 'invalid_or_expired',
            message:
              'This activation link is invalid or has expired. Ask your administrator to resend it.',
          },
        },
        { status: 400 },
      );
    }
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (updateError) {
    console.warn('staff_activate_set_password_failed', {
      correlationId,
      errorCode: updateError.code,
      errorStatus: updateError.status,
    });
    return NextResponse.json(
      {
        error: {
          code: 'set_password_failed',
          message: 'Could not set your password. Please try again.',
        },
      },
      { status: 400 },
    );
  }

  console.warn('staff_activate_password_set', { correlationId });
  return NextResponse.json({ ok: true });
}
