import { NextResponse, type NextRequest } from 'next/server';
import { phoneVerificationConfirmSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/safeError';

/**
 * POST /api/v1/phone-verification/confirm -- WhatsApp V1 completion pass, Phase F. Thin wrapper
 * over confirm_phone_verification() (migration 20260101000106), called through the caller's own
 * session-bound client -- only the original requester can confirm their own challenge, enforced
 * inside the RPC itself. Never leaks whether a wrong code was "close" -- just success/error_code/
 * attempts_remaining.
 */
export async function POST(request: NextRequest) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = phoneVerificationConfirmSchema.safeParse(body);
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

  const { data: rpcRows, error: rpcError } = await supabase
    .rpc('confirm_phone_verification', {
      p_challenge_id: parsed.data.challengeId,
      p_otp_code: parsed.data.otpCode,
    })
    .single();
  if (rpcError) {
    return NextResponse.json(
      {
        error: {
          code: 'phone_verification_confirm_failed',
          message: safeErrorMessage(
            rpcError,
            'Could not confirm this verification code. Please try again, or contact support if this continues.',
            'confirm_phone_verification',
          ),
        },
      },
      { status: 500 },
    );
  }

  const result = rpcRows as {
    success: boolean;
    error_code: string | null;
    attempts_remaining: number | null;
  };

  if (!result.success) {
    const status =
      result.error_code === 'forbidden' ? 403 : result.error_code === 'not_found' ? 404 : 400;
    return NextResponse.json(
      {
        error: {
          code: result.error_code ?? 'unknown',
          message: 'Verification failed.',
          attemptsRemaining: result.attempts_remaining,
        },
      },
      { status },
    );
  }

  return NextResponse.json({ verified: true });
}
