import { NextResponse, type NextRequest } from 'next/server';
import { applicationAccessTokenCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/applications/:id/access-tokens (Phase 4, migration 20260101000132). Issues (or
 * re-issues, revoking any prior active one) the secure applicant-intake link. RLS on
 * application_access_tokens + create_application_access_token()'s own internal check both already
 * enforce agent+/property-access -- this route does not duplicate that check, only surfaces the
 * RPC's own authorization failure as a normal error response. The plaintext token is returned
 * exactly once, here, to the issuing staff member's own response -- it is never stored, never
 * logged, and the caller is responsible for actually delivering it (email/WhatsApp send, Phase 11-13).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
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

  const parsed = applicationAccessTokenCreateSchema.safeParse(body);
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

  const { data, error } = await supabase
    .rpc('create_application_access_token', {
      p_application_id: id,
      p_delivery_channel: parsed.data.deliveryChannel,
      p_destination_hint: parsed.data.destinationHint ?? null,
    })
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'access_token_create_failed', message: error.message } },
      { status: 400 },
    );
  }

  const row = data as { token_id: string; token: string; expires_at: string };
  return NextResponse.json(
    { accessToken: { id: row.token_id, token: row.token, expiresAt: row.expires_at } },
    { status: 201 },
  );
}
