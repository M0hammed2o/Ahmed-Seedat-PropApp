import { NextResponse, type NextRequest } from 'next/server';
import { tenantUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapTenantRow } from '@/lib/leasing';

type RouteParams = { params: Promise<{ id: string }> };

async function loadVisibleTenant(supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>, id: string) {
  return supabase.from('tenants').select('*').eq('id', id).maybeSingle();
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
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

  const { data, error } = await loadVisibleTenant(supabase, id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'tenant_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Tenant not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ tenant: mapTenantRow(data) });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

  const { data: existing, error: fetchError } = await loadVisibleTenant(supabase, id);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'tenant_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Tenant not found.' } },
      { status: 404 },
    );
  }

  // Note: existing here may be visible via the self-access carve-out (tenants_select_org_or_self
  // -- user_id = auth.uid()) even when the caller holds no org membership at all. requireOrgRole
  // correctly returns false in that case (no organization_members row to satisfy has_org_role()),
  // so a tenant attempting to edit their own record via this endpoint gets a 403, not a silent
  // no-op -- consistent with "no tenant portal in V1" (there is deliberately no self-write RLS
  // policy either; this is a second, API-layer enforcement of the same rule, not new behavior).
  const canWrite = await requireOrgRole(supabase, existing.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to edit this tenant.' } },
      { status: 403 },
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

  const parsed = tenantUpdateSchema.safeParse(body);
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

  const patch: Record<string, unknown> = {};
  if (parsed.data.fullName !== undefined) patch.full_name = parsed.data.fullName;
  if (parsed.data.email !== undefined) patch.email = parsed.data.email;
  if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone;

  const { data, error } = await supabase.from('tenants').update(patch).eq('id', id).select('*').single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'tenant_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ tenant: mapTenantRow(data) });
}
