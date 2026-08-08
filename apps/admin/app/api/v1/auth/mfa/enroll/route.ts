import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS, branding } from '@propvault/config';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';

/**
 * POST /api/v1/auth/mfa/enroll (Stage 7, commercial-launch execution plan). Starts TOTP
 * enrollment for the *already signed-in* caller (Settings, not the sign-in flow) -- creates an
 * `unverified` factor and returns the QR code/secret for the user's authenticator app.
 * Enrollment is only actually confirmed by POST /api/v1/auth/mfa/enroll/verify; an enrolled-but-
 * never-verified factor from an abandoned attempt is inert (Supabase never counts it towards
 * `getAuthenticatorAssuranceLevel()`'s `nextLevel`).
 */
export async function POST(request: NextRequest) {
  const serviceClient = getServiceRoleClient();
  const limited = await rateLimitOrRespond(
    serviceClient,
    `auth-mfa-enroll:${resolveTrustedClientIp(request)}`,
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

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `${branding.productName} — ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) {
    return NextResponse.json(
      {
        error: { code: 'mfa_enroll_failed', message: 'Could not start MFA enrollment. Try again.' },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  });
}

const verifyEnrollSchema = z.object({
  factorId: z.string().min(1, 'factorId is required'),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});

/**
 * PATCH /api/v1/auth/mfa/enroll -- confirms an in-progress enrollment (the user scanned the QR
 * code and is submitting the first code their app generated). On success, Supabase itself
 * promotes the current session straight to AAL2 (no separate re-login step) and logs out every
 * other session for this account -- both documented GoTrueMFAApi behaviours, not something this
 * route does itself.
 */
export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = verifyEnrollSchema.safeParse(body);
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
    `auth-mfa-enroll-verify:${resolveTrustedClientIp(request)}`,
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

  return NextResponse.json({ verified: true });
}
