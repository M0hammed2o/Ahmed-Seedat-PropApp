import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/**
 * GET /api/v1/auth/mfa/factors (Stage 7, commercial-launch execution plan) -- lists the caller's
 * own enrolled TOTP factors, for Settings to render current enrollment status. Read-only, no rate
 * limit needed (nothing here is brute-forceable; it only ever returns the caller's own factors).
 */
export async function GET() {
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

  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    return NextResponse.json(
      { error: { code: 'mfa_factors_failed', message: 'Could not load MFA status.' } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    factors: (data?.totp ?? []).map((f) => ({
      id: f.id,
      friendlyName: f.friendly_name ?? null,
      status: f.status,
      createdAt: f.created_at,
    })),
  });
}
