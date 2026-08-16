import { NextResponse, type NextRequest } from 'next/server';
import { phoneVerificationRequestSchema } from '@propvault/validation';
import { getServerSupabaseClient, getServiceRoleClient } from '@/lib/supabase/server';
import { resolveEntityContactInfo } from '@/lib/phoneVerification';
import { dispatchEmail } from '@/lib/emailDispatch';
import { rateLimitOrRespond } from '@/lib/rateLimit';

/**
 * POST /api/v1/phone-verification/request -- WhatsApp V1 completion pass, Phase F (WORKLOG.md
 * this date). Issues a 6-digit, 10-minute OTP challenge via `request_phone_verification()`
 * (migration 20260101000106), called through the CALLER'S OWN session-bound client -- the RPC's
 * own ownership check (caller must BE the tenant/owner/organization_member requesting its own
 * verification) is the real authorization, not this route. Delivers the plaintext code by email
 * (the already-real, already-working channel) -- WhatsApp OTP delivery would need a Meta
 * Authentication-category template that doesn't exist yet, deliberately not built this pass.
 *
 * The plaintext code is NEVER returned in this route's own response -- only the RPC's immediate
 * (already-authenticated) caller inside Postgres ever sees it, and it's handed straight to
 * dispatchEmail() without being logged or echoed back over HTTP.
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

  const limited = await rateLimitOrRespond(supabase, `phone-verify-request:${user.id}`, 5, 3600);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = phoneVerificationRequestSchema.safeParse(body);
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
    .rpc('request_phone_verification', {
      p_entity_type: parsed.data.entityType,
      p_entity_id: parsed.data.entityId,
      p_phone_number_e164: parsed.data.phoneNumberE164,
    })
    .single();
  if (rpcError) {
    return NextResponse.json(
      { error: { code: 'phone_verification_request_failed', message: rpcError.message } },
      { status: 500 },
    );
  }

  const result = rpcRows as {
    challenge_id: string | null;
    otp_code: string | null;
    expires_at: string | null;
    error_code: string | null;
  };

  if (result.error_code || !result.challenge_id || !result.otp_code) {
    const status =
      result.error_code === 'forbidden' ? 403 : result.error_code === 'rate_limited' ? 429 : 400;
    return NextResponse.json(
      {
        error: {
          code: result.error_code ?? 'unknown',
          message: 'Could not start phone verification.',
        },
      },
      { status },
    );
  }

  const serviceClient = getServiceRoleClient();
  const contact = await resolveEntityContactInfo(
    serviceClient,
    parsed.data.entityType,
    parsed.data.entityId,
  );
  if (!contact?.email) {
    return NextResponse.json(
      {
        error: {
          code: 'no_email_on_file',
          message: 'No email address on file to deliver a verification code to.',
        },
      },
      { status: 422 },
    );
  }

  await dispatchEmail(serviceClient, {
    orgId: contact.orgId,
    toAddress: contact.email,
    templateName: 'phone_verification_code',
    templateVars: { code: result.otp_code },
    relatedEntityType: 'phone_verification_challenge',
    relatedEntityId: result.challenge_id,
    actorUserId: user.id,
  });

  return NextResponse.json({ challengeId: result.challenge_id, expiresAt: result.expires_at });
}
