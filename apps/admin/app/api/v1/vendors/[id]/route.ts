import { NextResponse, type NextRequest } from 'next/server';
import { vendorUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapVendorRow } from '@/lib/operations';

type RouteParams = { params: Promise<{ id: string }> };

async function loadVisibleVendor(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  id: string,
) {
  return supabase.from('vendors').select('*').eq('id', id).maybeSingle();
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

  const { data, error } = await loadVisibleVendor(supabase, id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'vendor_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Vendor not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ vendor: mapVendorRow(data) });
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

  const { data: existing, error: fetchError } = await loadVisibleVendor(supabase, id);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'vendor_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Vendor not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to edit this vendor.' } },
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

  const parsed = vendorUpdateSchema.safeParse(body);
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
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.tradeCategory !== undefined) patch.trade_category = parsed.data.tradeCategory;
  if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone;
  if (parsed.data.email !== undefined) patch.email = parsed.data.email;
  if (parsed.data.isExternal !== undefined) patch.is_external = parsed.data.isExternal;

  const { data, error } = await supabase
    .from('vendors')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'vendor_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ vendor: mapVendorRow(data) });
}
