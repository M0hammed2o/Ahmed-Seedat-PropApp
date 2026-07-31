import { NextResponse, type NextRequest } from 'next/server';
import { applicationDecisionSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapApplicationRow } from '@/lib/leasing';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/applications/:id/decide (API_SPEC.md §4: "approved -> atomically creates
 * tenant+lease+rent_schedule"). Decline is a simple single-table update (no atomicity concern);
 * approve calls approve_application() (supabase/migrations/20260101000031), the only sanctioned
 * way to create the tenant+lease+lease_tenants+rent_schedule rows together.
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

  const { data: existing, error: fetchError } = await supabase
    .from('applications')
    .select('org_id, status')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'application_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Application not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, existing.org_id, 'agent');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: { code: 'forbidden', message: 'You do not have permission to decide this application.' },
      },
      { status: 403 },
    );
  }

  if (existing.status === 'decided') {
    return NextResponse.json(
      { error: { code: 'already_decided', message: 'This application has already been decided.' } },
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

  const parsed = applicationDecisionSchema.safeParse(body);
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

  if (parsed.data.decision === 'declined') {
    const { data, error } = await supabase
      .from('applications')
      .update({
        status: 'decided',
        decision: 'declined',
        decision_reason: parsed.data.reason ?? null,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        { error: { code: 'decline_failed', message: error.message } },
        { status: 500 },
      );
    }

    return NextResponse.json({ application: mapApplicationRow(data) });
  }

  const { data: leaseId, error: approveError } = await supabase.rpc('approve_application', {
    p_application_id: id,
    p_rent_amount: parsed.data.rentAmount,
    p_deposit_amount: parsed.data.depositAmount,
    p_start_date: parsed.data.startDate,
    p_end_date: parsed.data.endDate ?? null,
  });

  if (approveError) {
    return NextResponse.json(
      { error: { code: 'approval_failed', message: approveError.message } },
      { status: 500 },
    );
  }

  const { data: application, error: refetchError } = await supabase
    .from('applications')
    .select('*')
    .eq('id', id)
    .single();
  if (refetchError) {
    return NextResponse.json(
      { error: { code: 'application_fetch_failed', message: refetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ application: mapApplicationRow(application), leaseId });
}
