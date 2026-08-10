import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ORGANIZATION_MEMBER_ROLES } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ orgId: string; userId: string }> };

const bodySchema = z.object({ role: z.enum(ORGANIZATION_MEMBER_ROLES) });

/**
 * POST /api/v1/organizations/:orgId/members/:userId/role (owner + staff access completion pass,
 * WORKLOG.md this date) -- thin wrapper over update_organization_member_role() (migration
 * 20260101000090), which enforces the manager+ role-ceiling rule and the last-Principal guard.
 */
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
      {
        error: {
          code: 'validation_failed',
          message: 'A valid role is required.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const { error } = await supabase.rpc('update_organization_member_role', {
    p_org_id: orgId,
    p_user_id: userId,
    p_role: parsed.data.role,
  });
  if (error) {
    return NextResponse.json(
      { error: { code: 'role_update_failed', message: error.message } },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
