import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { safeNextPathOr } from '@/lib/safeRedirect';

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
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const otpType = url.searchParams.get('type');
  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  // Validated -- an absolute-URL `next` (e.g. `?next=https://evil.example`) must never reach the
  // redirect below; see safeRedirect.ts's own comment for why this specific route needed it.
  const next = safeNextPathOr(url.searchParams.get('next'));

  if (providerError) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(providerError)}`, url.origin),
    );
  }

  const supabase = await getServerSupabaseClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(
          `/login?error=${encodeURIComponent('This link is invalid or has expired.')}`,
          url.origin,
        ),
      );
    }
  } else if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType as 'email' | 'signup' | 'recovery' | 'invite' | 'email_change',
    });
    if (error) {
      return NextResponse.redirect(
        new URL(
          `/login?error=${encodeURIComponent('This link is invalid or has expired.')}`,
          url.origin,
        ),
      );
    }
  } else {
    return NextResponse.redirect(new URL('/login', url.origin));
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
  return NextResponse.redirect(new URL(next, url.origin));
}
