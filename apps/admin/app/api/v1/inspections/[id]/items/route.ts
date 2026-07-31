import { NextResponse, type NextRequest } from 'next/server';
import { inspectionItemCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInspectionItemRow } from '@/lib/operations';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/inspections/:id/items (API_SPEC.md §5). */
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

  const { data: inspection, error: inspectionError } = await supabase
    .from('inspections')
    .select('id, org_id')
    .eq('id', id)
    .maybeSingle();
  if (inspectionError) {
    return NextResponse.json(
      { error: { code: 'inspection_fetch_failed', message: inspectionError.message } },
      { status: 500 },
    );
  }
  if (!inspection) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Inspection not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, inspection.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to add items to this inspection.' } },
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

  const parsed = inspectionItemCreateSchema.safeParse(body);
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

  const { data, error } = await supabase
    .from('inspection_items')
    .insert({
      inspection_id: id,
      room: parsed.data.room,
      item_description: parsed.data.itemDescription,
      condition_rating: parsed.data.conditionRating,
      notes: parsed.data.notes ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'inspection_item_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ inspectionItem: mapInspectionItemRow(data) }, { status: 201 });
}
