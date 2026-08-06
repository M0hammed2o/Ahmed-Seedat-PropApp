import { NextResponse, type NextRequest } from 'next/server';
import { updateProfileSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/**
 * GET/PATCH /api/v1/profile (PWA_V1_COMPLETION_PLAN.md #7). `public.profiles` has exactly one
 * app-level column beyond the auth-mirrored id (`display_name`) -- email/password changes go
 * straight through Supabase Auth client-side, never through this route. Every authenticated
 * identity has exactly one profiles row (auto-created by the `on_auth_user_created` trigger,
 * migration 20260101000004), so this works identically for org staff, owners, and tenants -- the
 * same third-identity-systems-never-merge boundary just doesn't apply here, since a display name
 * isn't role-scoped.
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

  const { data, error } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'profile_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    profile: { displayName: data?.display_name ?? null, email: user.email ?? null },
  });
}

export async function PATCH(request: NextRequest) {
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

  const parsed = updateProfileSchema.safeParse(body);
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

  const { error } = await supabase
    .from('profiles')
    .update({ display_name: parsed.data.displayName })
    .eq('id', user.id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'profile_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    profile: { displayName: parsed.data.displayName, email: user.email ?? null },
  });
}
