import { NextResponse, type NextRequest } from 'next/server';
import { forgotPasswordSchema } from '@propvault/validation';
import { RATE_LIMITS } from '@propvault/config';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { rateLimitOrRespond, requestIp } from '@/lib/rateLimit';

/**
 * POST /api/v1/auth/password-reset (Stage 7, commercial-launch execution plan,
 * TECHNICAL_DEBT_REGISTER.md TD-31). Same real-server-hook-point reasoning as
 * POST /api/v1/auth/signin -- ForgotPasswordForm.tsx previously called
 * `supabase.auth.resetPasswordForEmail()` directly from the browser.
 *
 * Always returns the same 200 regardless of whether the email is registered -- preserves
 * Supabase's own anti-enumeration behaviour (ForgotPasswordForm.tsx's original comment already
 * documented this; unchanged here, just moved server-side) and is also why this is rate-limited
 * per-IP only, not per-email: keying on an email an attacker can freely enumerate would leak
 * exactly the "does this account exist" signal the response itself deliberately withholds.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } }, { status: 400 });
  }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Check the highlighted fields.', field_errors: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }

  const serviceClient = getServiceRoleClient();
  const limited = await rateLimitOrRespond(serviceClient, `auth-password-reset-ip:${requestIp(request)}`, RATE_LIMITS.passwordResetAttemptsPerMinute, 60);
  if (limited) return limited;

  const supabase = await getServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${new URL(request.url).origin}/reset-password`,
  });

  if (error) {
    // Still a real infrastructure failure (e.g. email provider down) -- surfaced honestly, unlike
    // the deliberate "always looks the same" behaviour for the account-existence question itself.
    return NextResponse.json({ error: { code: 'password_reset_failed', message: 'Something went wrong sending the reset email. Try again.' } }, { status: 500 });
  }

  return NextResponse.json({ sent: true });
}
