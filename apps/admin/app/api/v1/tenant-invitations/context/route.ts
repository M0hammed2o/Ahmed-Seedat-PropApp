import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { resolveTrustedClientIp } from '@/lib/clientIp';

/**
 * GET /api/v1/tenant-invitations/context?token=... (tenant onboarding completion pass, Phase 2).
 * Deliberately unauthenticated-callable (a fresh invitation is opened signed-out by definition) --
 * thin wrapper over get_tenant_invitation_context(), which IS the authorization boundary (token
 * possession), same posture as accept/create already take. Returns only what that SECURITY
 * DEFINER function itself decided is safe to disclose at the caller's current auth state; this
 * route adds nothing beyond shaping the RPC's single-row result into JSON and rate limiting by IP
 * (token guessing is already astronomically infeasible -- 256 bits -- but costs nothing to bound
 * further).
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'A token is required.' } },
      { status: 400 },
    );
  }

  const supabase = await getServerSupabaseClient();

  const limited = await rateLimitOrRespond(
    supabase,
    `tenant-invitation-context:ip:${resolveTrustedClientIp(request)}`,
    30,
    60,
  );
  if (limited) return limited;

  const { data, error } = await supabase.rpc('get_tenant_invitation_context', {
    p_token: token,
  });
  if (error) {
    return NextResponse.json(
      { error: { code: 'tenant_invitation_context_failed', message: error.message } },
      { status: 500 },
    );
  }

  const result = data?.[0];
  if (!result || !result.valid) {
    return NextResponse.json({ valid: false });
  }

  return NextResponse.json({
    valid: true,
    orgName: result.org_name,
    expiresAt: result.expires_at,
    propertyLabel: result.property_label,
    unitLabel: result.unit_label,
  });
}
