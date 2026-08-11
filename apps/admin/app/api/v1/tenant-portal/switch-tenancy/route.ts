import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { getServerSupabaseClient } from '@/lib/supabase/server';

const switchTenancySchema = z.object({ tenantId: z.string().uuid() });

/**
 * POST /api/v1/tenant-portal/switch-tenancy (multi-tenancy architecture, WORKLOG.md this date).
 * Sets the `active_tenant_id` cookie resolveTenantSession() reads -- but only after confirming
 * the requested tenantId is genuinely one of the CALLER'S OWN `tenants` rows (never trusts the
 * client-supplied id alone, same "re-validate server-side" posture as every other identity check
 * in this codebase). A request for a tenancy that isn't the caller's own is rejected outright;
 * the cookie itself is never treated as an access grant either way -- every tenant-portal RLS
 * policy still scopes by `tenants.user_id = auth.uid()`/`caller_tenant_ids()`, this cookie only
 * selects WHICH of the caller's own tenancies resolveTenantSession() defaults to.
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

  const parsed = switchTenancySchema.safeParse(body);
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

  const { data: tenantRow, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', parsed.data.tenantId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'tenant_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!tenantRow) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'That tenancy does not belong to your account.',
        },
      },
      { status: 403 },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set('active_tenant_id', tenantRow.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ tenantId: tenantRow.id });
}
