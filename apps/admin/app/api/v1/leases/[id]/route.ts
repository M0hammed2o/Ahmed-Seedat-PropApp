import { NextResponse, type NextRequest } from 'next/server';
import { leaseUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapLeaseRow } from '@/lib/leasing';

type RouteParams = { params: Promise<{ id: string }> };

async function loadVisibleLease(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  id: string,
) {
  return supabase.from('leases').select('*').eq('id', id).maybeSingle();
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

  const { data, error } = await loadVisibleLease(supabase, id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Lease not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ lease: mapLeaseRow(data) });
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

  const { data: existing, error: fetchError } = await loadVisibleLease(supabase, id);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'lease_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Lease not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to edit this lease.' } },
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

  const parsed = leaseUpdateSchema.safeParse(body);
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
  if (parsed.data.startDate !== undefined) patch.start_date = parsed.data.startDate;
  if (parsed.data.endDate !== undefined) patch.end_date = parsed.data.endDate;
  if (parsed.data.rentAmount !== undefined) patch.rent_amount = parsed.data.rentAmount;
  if (parsed.data.depositAmount !== undefined) patch.deposit_amount = parsed.data.depositAmount;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;

  const { data, error } = await supabase
    .from('leases')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ lease: mapLeaseRow(data) });
}
