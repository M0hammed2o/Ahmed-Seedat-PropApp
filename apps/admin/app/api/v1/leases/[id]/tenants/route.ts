import { NextResponse, type NextRequest } from 'next/server';
import { leaseTenantAssignSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/leases/:id/tenants -- attaches an existing tenant to a lease that has none
 * (Stage 10: the lease detail page's "No tenant assigned to this lease yet." dead end). Thin
 * wrapper over assign_lease_tenant() (migration 20260101000078) -- the RPC itself is not security
 * definer, so this route's only job is the standard auth/visibility/role checks every other lease
 * write route already does before calling it.
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

  const { data: lease, error: fetchError } = await supabase
    .from('leases')
    .select('id, org_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'lease_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!lease) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Lease not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, lease.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to assign a tenant to this lease.',
        },
      },
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

  const parsed = leaseTenantAssignSchema.safeParse(body);
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

  const { error: rpcError } = await supabase.rpc('assign_lease_tenant', {
    p_lease_id: id,
    p_tenant_id: parsed.data.tenantId,
    p_is_primary: parsed.data.isPrimary,
  });

  if (rpcError) {
    return NextResponse.json(
      { error: { code: 'lease_tenant_assign_failed', message: rpcError.message } },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
