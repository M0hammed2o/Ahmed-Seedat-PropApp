import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInspectionRow } from '@/lib/operations';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/inspections/:id/complete (API_SPEC.md §5: "rejects if neither both-signed nor
 * refusal-logged"). This exact rule is also a hard DB CHECK constraint
 * (supabase/migrations/20260101000034) -- checked here first for a clear, specific error message;
 * the constraint is what actually guarantees the invariant holds even against a direct/service-
 * role write, since TASKS.md M14's deposit-release gate depends on it being genuinely true.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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
    .select('*')
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
      { error: { code: 'forbidden', message: 'You do not have permission to complete this inspection.' } },
      { status: 403 },
    );
  }

  if (inspection.status === 'completed') {
    return NextResponse.json(
      { error: { code: 'already_completed', message: 'This inspection has already been completed.' } },
      { status: 409 },
    );
  }

  const hasBothSignatures = Boolean(inspection.landlord_signed_at) && Boolean(inspection.tenant_signed_at);
  const hasRefusalLogged = Boolean(inspection.landlord_signed_at) && Boolean(inspection.tenant_refusal_reason);
  if (!hasBothSignatures && !hasRefusalLogged) {
    return NextResponse.json(
      {
        error: {
          code: 'signatures_incomplete',
          message: 'Completion requires the landlord and tenant to both sign, or a logged tenant refusal reason.',
        },
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('inspections')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'inspection_complete_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ inspection: mapInspectionRow(data) });
}
