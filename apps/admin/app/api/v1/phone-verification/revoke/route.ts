import { NextResponse, type NextRequest } from 'next/server';
import { phoneVerificationRevokeSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/**
 * POST /api/v1/phone-verification/revoke -- WhatsApp V1 completion pass, Phase F. Thin wrapper
 * over revoke_verified_phone_number() (migration 20260101000106) -- lets a caller remove their own
 * verified phone (e.g. before verifying a replacement number). Ownership-gated inside the RPC,
 * same as request/confirm.
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

  const parsed = phoneVerificationRevokeSchema.safeParse(body);
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
    .rpc('revoke_verified_phone_number', {
      p_entity_type: parsed.data.entityType,
      p_entity_id: parsed.data.entityId,
      p_phone_number_e164: parsed.data.phoneNumberE164,
    })
    .single();
  if (rpcError) {
    return NextResponse.json(
      { error: { code: 'phone_verification_revoke_failed', message: rpcError.message } },
      { status: 500 },
    );
  }

  const result = rpcRows as { success: boolean; error_code: string | null };
  if (!result.success) {
    return NextResponse.json(
      {
        error: {
          code: result.error_code ?? 'unknown',
          message: 'Could not revoke this phone number.',
        },
      },
      { status: result.error_code === 'forbidden' ? 403 : 400 },
    );
  }

  return NextResponse.json({ revoked: true });
}
