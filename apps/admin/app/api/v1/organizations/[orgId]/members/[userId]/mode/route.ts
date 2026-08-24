import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { isPrincipalOnlyDenial } from '@/lib/staffAuthorizationErrors';

type RouteParams = { params: Promise<{ orgId: string; userId: string }> };

const bodySchema = z.object({ mode: z.enum(['all', 'selected']) });

/** POST /api/v1/organizations/:orgId/members/:userId/mode -- thin wrapper over
 * set_member_property_access_mode() (migration 20260101000084); authorization (manager+) is
 * enforced inside the RPC itself. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { orgId, userId } = await params;
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'mode must be "all" or "selected".' } },
      { status: 400 },
    );
  }

  const { error } = await supabase.rpc('set_member_property_access_mode', {
    p_org_id: orgId,
    p_user_id: userId,
    p_mode: parsed.data.mode,
  });
  if (error) {
    // Staff security + audit hardening follow-up (this date): narrow, exact-match mapping to 403
    // for the RPC's own known principal-only denial only -- see lib/staffAuthorizationErrors.ts.
    // The Principal self-protection guard ("Principal property access cannot be changed via this
    // action") is deliberately NOT included -- that's a business rule, not a role-insufficiency
    // signal, and stays 400.
    const status = isPrincipalOnlyDenial(error.message) ? 403 : 400;
    return NextResponse.json(
      { error: { code: 'set_mode_failed', message: error.message } },
      { status },
    );
  }

  return NextResponse.json({ ok: true });
}
