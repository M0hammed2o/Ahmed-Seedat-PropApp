import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { registerSchema } from '@propvault/validation';
import { RATE_LIMITS } from '@propvault/config';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { rateLimitOrRespond, requestIp } from '@/lib/rateLimit';
import { isSafeNextPath } from '@/lib/safeRedirect';
import { getRequestOrigin } from '@/lib/appUrl';

// emailRedirectTo is computed client-side today (RegisterForm.tsx uses window.location.origin,
// which a server route has no access to) -- accepted as an input here rather than guessed
// server-side, validated as a same-origin *path* (never a full external URL) so this can never be
// abused to redirect a real confirmation email's link to an attacker-controlled origin.
//
// `isSafeNextPath` (not a bare `.startsWith('/')`, the weaker check this replaced) -- a plain
// `startsWith('/')` still accepts `//evil.example`, which every browser resolves as a
// protocol-relative (i.e. external) URL, the exact class of bug this field exists to prevent.
const signupSchema = registerSchema.and(
  z.object({ next: z.string().refine(isSafeNextPath, 'next must be a same-origin path') }),
);

/**
 * POST /api/v1/auth/signup (Stage 7, commercial-launch execution plan, TECHNICAL_DEBT_REGISTER.md
 * TD-31). Same real-server-hook-point reasoning as POST /api/v1/auth/signin -- RegisterForm.tsx
 * previously called `supabase.auth.signUp()` directly from the browser.
 *
 * Rate-limited per-IP only (not per-email): unlike signin, an attacker can supply arbitrary
 * not-yet-registered emails, so an email-keyed bucket would never accumulate -- IP is the only
 * meaningful signal against a mass-account-creation attempt here.
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

  const parsed = signupSchema.safeParse(body);
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
    `auth-signup-ip:${requestIp(request)}`,
    RATE_LIMITS.signupAttemptsPerMinute,
    60,
  );
  if (limited) return limited;

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${getRequestOrigin(request.headers)}/auth/callback?next=${encodeURIComponent(parsed.data.next)}`,
    },
  });

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: /already registered|already exists/i.test(error.message)
            ? 'account_exists'
            : 'signup_failed',
          message: /already registered|already exists/i.test(error.message)
            ? 'An account with this email already exists. Try signing in instead.'
            : 'Could not create your account. Check your details and try again.',
        },
      },
      { status: 422 },
    );
  }

  // Mirrors RegisterForm.tsx's own prior logic exactly: signUp() only returns a live session
  // immediately when email confirmations are disabled for this project; this project has them ON
  // (supabase/config.toml [auth.email]), so `hasSession` is expected to be false in real use and
  // the client shows "check your email" -- surfaced explicitly rather than assumed by the caller.
  return NextResponse.json({ hasSession: Boolean(data.session) });
}
