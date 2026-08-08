import { NextResponse, type NextRequest } from 'next/server';
import { loginSchema } from '@propvault/validation';
import { RATE_LIMITS } from '@propvault/config';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';
import { auditPlatformAdminLoginIfApplicable } from '@/lib/audit';

/**
 * POST /api/v1/auth/signin (Stage 7, commercial-launch execution plan, TECHNICAL_DEBT_REGISTER.md
 * TD-31). Real server-side hook point for sign-in -- LoginForm.tsx previously called
 * `supabase.auth.signInWithPassword()` directly from the browser, which meant nothing server-side
 * ever saw the request and rate limiting was structurally impossible to apply. This route is now
 * the only sign-in path: `getServerSupabaseClient()`'s cookie-writing SSR client establishes the
 * session exactly as any other server-side Supabase Auth call in this codebase does, so the
 * browser ends up with the same cookie-based session it would have gotten from a client-side call.
 *
 * Rate-limited on TWO independent buckets, both required to pass: per-IP (stops one attacker
 * hammering many accounts) and per-email (stops credential stuffing against one specific account
 * from many IPs) -- either alone misses half the threat model.
 *
 * MFA (Stage 7): a successful password check does not necessarily mean the session is usable yet
 * -- if the account has a verified TOTP factor, Supabase's own session `getAuthenticatorAssuranceLevel()`
 * reports `currentLevel: 'aal1'` while `nextLevel: 'aal2'` is required. This route surfaces that as
 * `mfaRequired`/`factorId` rather than treating a password-only success as a completed sign-in --
 * the caller must then call POST /api/v1/auth/mfa/verify with a TOTP code before the session is
 * fully authenticated for accessing protected routes (`getAdminSession()`/`resolvePortalSession()`
 * read the same Supabase session Supabase itself gates on AAL where relevant).
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

  const parsed = loginSchema.safeParse(body);
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
  const ip = resolveTrustedClientIp(request);
  const normalizedEmail = parsed.data.email.trim().toLowerCase();

  const ipLimited = await rateLimitOrRespond(
    serviceClient,
    `auth-signin-ip:${ip}`,
    RATE_LIMITS.loginAttemptsPerMinute,
    60,
  );
  if (ipLimited) return ipLimited;
  const emailLimited = await rateLimitOrRespond(
    serviceClient,
    `auth-signin-email:${normalizedEmail}`,
    RATE_LIMITS.loginAttemptsPerMinute,
    60,
  );
  if (emailLimited) return emailLimited;

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.session) {
    // Deliberately identical message/status for "no such account" and "wrong password" -- the
    // same anti-enumeration posture ForgotPasswordForm.tsx's own comment already documents for
    // password reset, applied here to sign-in.
    return NextResponse.json(
      { error: { code: 'invalid_credentials', message: 'Invalid email or password.' } },
      { status: 401 },
    );
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== aal.nextLevel) {
    const { data: factorsData } = await supabase.auth.mfa.listFactors();
    const factorId = factorsData?.totp?.[0]?.id;
    if (factorId) {
      return NextResponse.json({ mfaRequired: true, factorId });
    }
    // An account whose AAL requirement says aal2 but has no listable TOTP factor is an
    // inconsistent state this route cannot resolve -- fails closed (never silently treats it as
    // "no MFA needed") rather than guessing.
    return NextResponse.json(
      {
        error: {
          code: 'mfa_state_error',
          message: 'Could not verify your account’s second factor. Contact support.',
        },
      },
      { status: 500 },
    );
  }

  // Fires only for accounts with no MFA factor at all (the "step up" case completes at
  // /api/v1/auth/mfa/verify instead) -- for a platform admin with no factor enrolled, this
  // session still won't satisfy getAdminSession()'s AAL2 requirement, but the sign-in itself
  // (password verified, identity established) is the event worth recording either way.
  await auditPlatformAdminLoginIfApplicable(serviceClient, data.session.user.id);

  return NextResponse.json({ mfaRequired: false });
}
