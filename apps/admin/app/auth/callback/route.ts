import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { safeNextPathOr } from '@/lib/safeRedirect';
import { getRequestOrigin } from '@/lib/appUrl';

/**
 * GET /auth/callback (PRODUCT DECISION 1, 2026-08-03). The single landing point for every
 * redirect-based auth flow this app has: Google/Apple OAuth (`?code=...`), and email
 * verification links (`?code=...` for the current PKCE-style confirmation link, or the legacy
 * `?token_hash=...&type=...` OTP-link shape as a fallback -- ResetPasswordForm.tsx's own comment
 * already documented that this Supabase project's email links moved to `?code=` PKCE by default;
 * kept the OTP fallback here defensively since Supabase's own docs describe both shapes existing
 * across template configurations).
 *
 * `next` is preserved end-to-end so "invitation continuation after authentication" works: a user
 * who clicked Google from an org-invite or tenant-activation page returns to that exact page, not
 * a generic dashboard, with their new session already established.
 */

/**
 * Diagnostic-only (WORKLOG.md this date) -- investigating a real production report: a single tap
 * of the email confirmation link sometimes shows "This link is invalid or has expired" even
 * though the confirmation actually succeeded. The email's `{{ .ConfirmationURL }}` points
 * directly at Supabase's own GoTrue `/auth/v1/verify` (a consuming GET, outside this app
 * entirely) -- reproduced locally that ANY second GET to that same link, from any source, returns
 * `otp_expired` after the first succeeds. This logging exists to capture, from real production
 * traffic, what actually issues that second request (a proxy/scanner, a mobile mail-app webview
 * handoff, or something else) -- never logs the token/code/verifier itself, only request shape
 * and outcome. `next` is logged as pathname-only (its query string could carry an invitation
 * token, which must never be logged either).
 */
function logCallbackEvent(event: string, fields: Record<string, unknown>) {
  console.warn(event, fields);
}

function pathnameOnly(next: string): string {
  try {
    return new URL(next, 'http://internal').pathname;
  } catch {
    return next;
  }
}

/**
 * Real, live-caught gap this closes: the previous version redirected straight to `/login?error=…`
 * for ANY provider-supplied error or failed exchange, without ever checking whether the SAME
 * browser already holds a valid, confirmed session -- which happens whenever a second request for
 * an already-consumed confirmation link reaches this route after the first one already succeeded
 * (see this file's own comment on `logCallbackEvent`). A caller who is, in fact, already signed in
 * and confirmed is routed straight into the app instead of being shown a dead-end error. This does
 * NOT fully solve every possible duplicate-request source (a request from a different
 * device/context never shares this browser's session cookie), which is exactly why the
 * architectural fix (a non-consuming confirmation page) is still the real solution -- this is the
 * smallest safe improvement available before that lands.
 */
async function resolveFailureOutcome(
  supabase: SupabaseClient,
  correlationId: string,
  origin: string,
  next: string,
  errorCode: string | null,
  fallbackMessage: string,
): Promise<NextResponse> {
  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();

  if (existingUser && existingUser.email_confirmed_at) {
    logCallbackEvent('auth_callback_already_confirmed_recovered', {
      correlationId,
      next: pathnameOnly(next),
    });
    return NextResponse.redirect(new URL(next, origin));
  }

  // `otp_expired` covers both "genuinely stale" and "already consumed" -- GoTrue does not
  // distinguish them in this error (by design, to avoid leaking token state). Without an
  // existing session to confirm the happy case above, the honest message acknowledges both
  // possibilities rather than asserting either one.
  const message =
    errorCode === 'otp_expired'
      ? 'This confirmation link has already been used or has expired. If you already confirmed your account, sign in below — otherwise request a new confirmation email.'
      : fallbackMessage;

  logCallbackEvent('auth_callback_error_redirect', {
    correlationId,
    errorCode,
    hadExistingSession: Boolean(existingUser),
  });

  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin));
}

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID();
  const url = new URL(request.url);
  const origin = getRequestOrigin(request.headers);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const otpType = url.searchParams.get('type');
  const errorCode = url.searchParams.get('error_code');
  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  // Validated -- an absolute-URL `next` (e.g. `?next=https://evil.example`) must never reach the
  // redirect below; see safeRedirect.ts's own comment for why this specific route needed it.
  const next = safeNextPathOr(url.searchParams.get('next'));

  logCallbackEvent('auth_callback_received', {
    correlationId,
    shape: code ? 'code' : tokenHash && otpType ? 'token_hash' : providerError ? 'error' : 'none',
    otpType: otpType ?? undefined,
    errorCode: errorCode ?? undefined,
    next: pathnameOnly(next),
    userAgent: request.headers.get('user-agent'),
    referer: request.headers.get('referer'),
  });

  const supabase = await getServerSupabaseClient();

  if (providerError) {
    return resolveFailureOutcome(supabase, correlationId, origin, next, errorCode, providerError);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logCallbackEvent('auth_callback_exchange_failed', {
        correlationId,
        errorCode: error.code,
        errorStatus: error.status,
      });
      return resolveFailureOutcome(
        supabase,
        correlationId,
        origin,
        next,
        error.code ?? null,
        'This link is invalid or has expired.',
      );
    }
  } else if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType as 'email' | 'signup' | 'recovery' | 'invite' | 'email_change',
    });
    if (error) {
      logCallbackEvent('auth_callback_verify_failed', {
        correlationId,
        errorCode: error.code,
        errorStatus: error.status,
      });
      return resolveFailureOutcome(
        supabase,
        correlationId,
        origin,
        next,
        error.code ?? null,
        'This link is invalid or has expired.',
      );
    }
  } else {
    logCallbackEvent('auth_callback_no_params_redirect_login', { correlationId });
    return NextResponse.redirect(new URL('/login', origin));
  }

  // Duplicate-account prevention (PRODUCT DECISION 1): this route never merges auth identities
  // itself -- Supabase Auth has no supported "merge these two already-distinct auth.users rows"
  // operation, and PERMISSIONS.md's "never merge based on an unverified email" rules out doing
  // it manually here from a client-supplied value anyway. The sanctioned way for one person to
  // gain a second sign-in method against their SAME auth.users.id (preserving org memberships,
  // tenant links, and audit history exactly, since the id never changes) is
  // supabase.auth.linkIdentity() called from an already-authenticated session --
  // components/settings/LinkedAccountsPanel.tsx, reachable from /settings. This callback's only
  // job once a session exists is to route onward; profiles is auto-created for any new
  // auth.users row (including OAuth ones) by the on_auth_user_created trigger (migration
  // 20260101000004), so there is nothing else to provision here.
  logCallbackEvent('auth_callback_success_redirect', { correlationId, next: pathnameOnly(next) });
  return NextResponse.redirect(new URL(next, origin));
}
