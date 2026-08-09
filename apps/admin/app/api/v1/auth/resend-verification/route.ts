import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { RATE_LIMITS } from '@propvault/config';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';
import { getRequestOrigin } from '@/lib/appUrl';
import { safeNextPathOr } from '@/lib/safeRedirect';

const resendSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  next: z.string().optional(),
});

/**
 * POST /api/v1/auth/resend-verification -- the "Check your email" screen's Resend button
 * (WORKLOG.md this date). Same anti-enumeration posture as password-reset: always the same 200
 * response regardless of whether the address is registered or already confirmed, so this can
 * never be used to probe account existence. Rate-limited per-IP only, for the same reason
 * signup itself is (an attacker supplies arbitrary addresses; a per-email bucket would never
 * meaningfully accumulate against a real target).
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

  const parsed = resendSchema.safeParse(body);
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
    `auth-resend-verification-ip:${resolveTrustedClientIp(request)}`,
    RATE_LIMITS.resendVerificationAttemptsPerMinute,
    60,
  );
  if (limited) return limited;

  const origin = getRequestOrigin(request.headers);
  const next = safeNextPathOr(parsed.data.next, '/');
  const supabase = await getServerSupabaseClient();

  // Errors (including "already confirmed" / "not found") are deliberately never surfaced --
  // resend() failing for either reason looks identical to success from the outside, matching
  // password-reset's own documented anti-enumeration reasoning.
  await supabase.auth.resend({
    type: 'signup',
    email: parsed.data.email,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  return NextResponse.json({ sent: true });
}
