import { NextResponse, type NextRequest } from 'next/server';
import { unitUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapUnitRow, requireOrgRole } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ id: string }> };

async function loadVisibleUnit(supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>, id: string) {
  return supabase.from('units').select('*').eq('id', id).maybeSingle();
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

  const { data, error } = await loadVisibleUnit(supabase, id);
  if (error) {
    return NextResponse.json(
      { error: { code: 'unit_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Unit not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ unit: mapUnitRow(data) });
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

  const { data: existing, error: fetchError } = await loadVisibleUnit(supabase, id);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'unit_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Unit not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to edit this unit.' } },
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

  const parsed = unitUpdateSchema.safeParse(body);
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
  if (parsed.data.unitLabel !== undefined) patch.unit_label = parsed.data.unitLabel;
  if (parsed.data.bedrooms !== undefined) patch.bedrooms = parsed.data.bedrooms;
  if (parsed.data.bathrooms !== undefined) patch.bathrooms = parsed.data.bathrooms;
  if (parsed.data.sizeSqm !== undefined) patch.size_sqm = parsed.data.sizeSqm;
  if (parsed.data.marketRent !== undefined) patch.market_rent = parsed.data.marketRent;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;

  const { data, error } = await supabase.from('units').update(patch).eq('id', id).select('*').single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'unit_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ unit: mapUnitRow(data) });
}
