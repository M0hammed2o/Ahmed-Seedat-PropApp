import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ orgId: string; userId: string }> };

const PROPERTY_ROLES = [
  'read_only',
  'property_manager',
  'accountant',
  'maintenance_manager',
  'owner',
  'administrator',
] as const;

const grantSchema = z.object({
  propertyId: z.string().uuid(),
  propertyRole: z.enum(PROPERTY_ROLES),
});

/**
 * GET/POST/DELETE /api/v1/organizations/:orgId/members/:userId/property-access (shared-access
 * architecture pass, WORKLOG.md this date). Thin wrapper over the already-existing
 * grant_property_access()/revoke_property_access() RPCs (migration 20260101000063) -- this route
 * is purely the missing UI-facing surface; the authorization logic already lived in those RPCs
 * (manager+ only) before this pass.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
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
  const canManage = await requireOrgRole(supabase, orgId, 'manager');
  if (!canManage) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to view this.' } },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('property_access')
    .select('property_id, property_role, properties(id, nickname)')
    .eq('user_id', userId);
  if (error) {
    return NextResponse.json(
      { error: { code: 'property_access_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  const grants = (data ?? [])
    .filter((row) => row.properties)
    .map((row) => ({
      propertyId: row.property_id,
      propertyRole: row.property_role,
      propertyNickname: (row.properties as unknown as { nickname: string }).nickname,
    }));

  return NextResponse.json({ grants });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { userId } = await params;
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
  const parsed = grantSchema.safeParse(body);
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

  const { error } = await supabase.rpc('grant_property_access', {
    p_property_id: parsed.data.propertyId,
    p_user_id: userId,
    p_property_role: parsed.data.propertyRole,
  });
  if (error) {
    return NextResponse.json(
      { error: { code: 'grant_failed', message: error.message } },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { userId } = await params;
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

  const propertyId = new URL(request.url).searchParams.get('propertyId');
  if (!propertyId) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'propertyId query param is required.' } },
      { status: 400 },
    );
  }

  const { error } = await supabase.rpc('revoke_property_access', {
    p_property_id: propertyId,
    p_user_id: userId,
  });
  if (error) {
    return NextResponse.json(
      { error: { code: 'revoke_failed', message: error.message } },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
