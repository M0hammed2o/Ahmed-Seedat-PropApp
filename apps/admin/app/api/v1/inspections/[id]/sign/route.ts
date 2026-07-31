import { NextResponse, type NextRequest } from 'next/server';
import { inspectionSignSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInspectionRow } from '@/lib/operations';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/inspections/:id/sign (API_SPEC.md §5: "landlord or tenant signature; refusal
 * reason accepted in lieu of tenant signature"). Landlord and tenant sign independently, in
 * separate calls -- there is no tenant portal in V1, so in practice both signatures are currently
 * captured by staff (e.g. on a handheld device during the walkthrough), but the schema and this
 * endpoint don't assume that; `signer` is an explicit input, not inferred from the caller's role.
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

  const { data: inspection, error: inspectionError } = await supabase
    .from('inspections')
    .select('id, org_id, status')
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
      { error: { code: 'forbidden', message: 'You do not have permission to sign this inspection.' } },
      { status: 403 },
    );
  }

  if (inspection.status === 'completed') {
    return NextResponse.json(
      { error: { code: 'already_completed', message: 'This inspection has already been completed.' } },
      { status: 409 },
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

  const parsed = inspectionSignSchema.safeParse(body);
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

  const patch: Record<string, unknown> =
    parsed.data.signer === 'landlord'
      ? { landlord_signed_at: new Date().toISOString() }
      : parsed.data.refusalReason
        ? { tenant_refusal_reason: parsed.data.refusalReason, tenant_signed_at: null }
        : { tenant_signed_at: new Date().toISOString(), tenant_refusal_reason: null };

  const { data, error } = await supabase
    .from('inspections')
    .update({ ...patch, status: 'awaiting_signature' })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'inspection_sign_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ inspection: mapInspectionRow(data) });
}
