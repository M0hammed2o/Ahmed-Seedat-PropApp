import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS } from '@propvault/config';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';
import { auditPlatformAdminLoginIfApplicable } from '@/lib/audit';

const mfaVerifySchema = z.object({
  factorId: z.string().min(1, 'factorId is required'),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});

/**
 * POST /api/v1/auth/mfa/verify (Stage 7, commercial-launch execution plan). Completes the second
 * factor of sign-in for an account with TOTP enrolled -- called after POST /api/v1/auth/signin
 * returns `mfaRequired: true`. Runs against the SAME cookie-based session signin already
 * established (an AAL1 session -- password verified, second factor not yet) via
 * `getServerSupabaseClient()` reading the same cookies; `challengeAndVerify()` elevates that
 * session's own assurance level to AAL2 in place and the SSR client's cookie-write mechanism
 * persists the updated session automatically, exactly as any other server-side Supabase Auth call
 * in this codebase does.
 *
 * Rate-limited per-IP: a 6-digit TOTP code has a real (if small) guessable space, and this is
 * exactly the kind of endpoint a brute-force attempt would target once an attacker already has a
 * valid password (e.g. from a breach) and is trying to defeat the second factor.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = mfaVerifySchema.safeParse(body);
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
    `auth-mfa-verify:${resolveTrustedClientIp(request)}`,
    RATE_LIMITS.mfaVerifyAttemptsPerMinute,
    60,
  );
  if (limited) return limited;

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

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) {
    return NextResponse.json(
      { error: { code: 'invalid_mfa_code', message: 'Incorrect or expired code. Try again.' } },
      { status: 401 },
    );
  }

  // The MFA-required completion point of sign-in (paired with the no-MFA-needed one in
  // /api/v1/auth/signin) -- this is where a platform admin WITH a factor enrolled actually
  // reaches AAL2 and completes sign-in.
  await auditPlatformAdminLoginIfApplicable(serviceClient, user.id);

  return NextResponse.json({ verified: true });
}
