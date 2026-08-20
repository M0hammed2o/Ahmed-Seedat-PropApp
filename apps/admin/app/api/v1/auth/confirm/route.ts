import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS } from '@propvault/config';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';

// Email-confirmation cross-device-safe rewrite (WORKLOG.md this date). This route is the ONLY
// thing that ever calls verifyOtp() for a signup confirmation -- GET /auth/confirm (the page the
// email link points at) never consumes anything by itself; only this explicit, user-initiated POST
// does. That split is the entire fix: an email security scanner, Gmail's link-preview fetcher, or
// any other automated GET can visit the page as many times as it wants without spending the token,
// because spending it requires this separate POST a script/scanner never issues.
//
// Deliberately narrow: `type` is not trusted from the client beyond confirming it's exactly
// 'signup' -- this route's only legitimate purpose is signup confirmation (never recovery/invite/
// email_change, which have their own existing flows), so there's nothing to gain from accepting a
// wider type here.
const confirmSchema = z.object({
  tokenHash: z.string().min(1, 'A confirmation token is required'),
  type: z.literal('signup'),
});

// Four distinct client-facing outcomes (Phase 4's own requirement: no single generic error for
// every case) -- but note what's NOT distinguished: "already confirmed" vs "genuinely expired".
// GoTrue reports both as the identical otp_expired error, deliberately, specifically so a caller
// can never use this endpoint to probe whether a given token was ever valid at all (the same
// anti-enumeration posture POST /api/v1/auth/resend-verification already documents). Rather than
// invent a distinction GoTrue itself won't support safely, this route only ever claims
// 'already_confirmed' when it can prove it honestly: the SAME request's own session, after the
// failed verify, already belongs to a confirmed user (mirrors auth/callback/route.ts's own
// resolveFailureOutcome() pattern exactly, reused here rather than re-invented). Every other
// otp_expired case is reported as the honest, combined 'used_or_expired' state.
type ConfirmOutcome = 'success' | 'already_confirmed' | 'used_or_expired' | 'invalid';

export async function POST(request: NextRequest) {
  const correlationId = crypto.randomUUID();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ outcome: 'invalid' satisfies ConfirmOutcome }, { status: 400 });
  }

  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ outcome: 'invalid' satisfies ConfirmOutcome }, { status: 400 });
  }

  const serviceClient = getServiceRoleClient();
  const limited = await rateLimitOrRespond(
    serviceClient,
    `auth-email-confirm-ip:${resolveTrustedClientIp(request)}`,
    RATE_LIMITS.emailConfirmAttemptsPerMinute,
    60,
  );
  if (limited) return limited;

  const supabase = await getServerSupabaseClient();

  // Never log the token itself -- only its outcome, matching every other auth route's own
  // established "correlation id + safe code, never the secret value" logging convention
  // (auth/callback/route.ts's logCallbackEvent, app/api/v1/auth/signup/route.ts's own comment).
  const { error } = await supabase.auth.verifyOtp({
    token_hash: parsed.data.tokenHash,
    type: 'signup',
  });

  if (!error) {
    console.warn('auth_confirm_success', { correlationId });
    return NextResponse.json({ outcome: 'success' satisfies ConfirmOutcome });
  }

  console.warn('auth_confirm_verify_failed', {
    correlationId,
    errorCode: error.code,
    errorStatus: error.status,
  });

  if (error.code === 'otp_expired') {
    // Same recovery check as auth/callback/route.ts's resolveFailureOutcome(): this can only ever
    // be honest when the SAME request already carries a session for a confirmed user (e.g. this
    // exact browser already succeeded on an earlier click). A request from a different
    // device/context, or a token that was never valid at all, cannot be distinguished from a
    // genuinely stale one -- and must not be, per this route's own anti-enumeration comment above.
    const {
      data: { user: existingUser },
    } = await supabase.auth.getUser();
    if (existingUser && existingUser.email_confirmed_at) {
      return NextResponse.json({ outcome: 'already_confirmed' satisfies ConfirmOutcome });
    }
    return NextResponse.json(
      { outcome: 'used_or_expired' satisfies ConfirmOutcome },
      { status: 400 },
    );
  }

  return NextResponse.json({ outcome: 'invalid' satisfies ConfirmOutcome }, { status: 400 });
}
