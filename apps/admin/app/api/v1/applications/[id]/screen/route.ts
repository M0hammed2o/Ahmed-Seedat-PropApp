import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapApplicationRow } from '@/lib/leasing';
import { getTenantScreeningProvider } from '@/lib/providers/tenantScreening';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/applications/:id/screen (API_SPEC.md §4). Requires screening_consent_at to already
 * be set -- enforced here with a clear 400 (rather than letting the applications table's own
 * CHECK constraint reject it with a raw Postgres error) and independently by that same DB
 * constraint regardless of what this route does, per the two-layer enforcement pattern
 * (PERMISSIONS.md).
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

  const { data: existing, error: fetchError } = await supabase
    .from('applications')
    .select('org_id, applicant_name, applicant_email, screening_consent_at, status')
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
        error: {
          code: 'forbidden',
          message: 'You do not have permission to screen this application.',
        },
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

  if (!existing.screening_consent_at) {
    return NextResponse.json(
      {
        error: {
          code: 'consent_required',
          message: 'Screening consent must be recorded before screening can run.',
        },
      },
      { status: 400 },
    );
  }

  const provider = getTenantScreeningProvider();
  const result = await provider.runScreening({
    applicantName: existing.applicant_name,
    applicantEmail: existing.applicant_email,
  });

  const { data, error } = await supabase
    .from('applications')
    .update({ screening_status: result.status, status: 'screening' })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'screening_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({
    application: mapApplicationRow(data),
    screeningReference: result.reference,
  });
}
