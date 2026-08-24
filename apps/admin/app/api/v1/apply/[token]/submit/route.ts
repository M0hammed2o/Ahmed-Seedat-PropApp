import { NextResponse, type NextRequest } from 'next/server';
import { applicationSelfServiceSubmitSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ token: string }> };

/**
 * POST /api/v1/apply/:token/submit (Phase 4-7, migration 20260101000132). Public, token-scoped.
 * Idempotent while the application is still invited/submitted/reviewing -- see
 * submit_application_by_token()'s own comment for exactly what it does and does not accept.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token } = await params;
  const supabase = await getServerSupabaseClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = applicationSelfServiceSubmitSchema.safeParse(body);
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
    .rpc('submit_application_by_token', {
      p_token: token,
      p_applicant_name: parsed.data.applicantName,
      p_applicant_email: parsed.data.applicantEmail ?? null,
      p_applicant_phone: parsed.data.applicantPhone ?? null,
      p_date_of_birth: parsed.data.dateOfBirth ?? null,
      p_current_address: parsed.data.currentAddress ?? null,
      p_employment_status: parsed.data.employmentStatus ?? null,
      p_employer_name: parsed.data.employerName ?? null,
      p_monthly_income: parsed.data.monthlyIncome ?? null,
      p_household_size: parsed.data.householdSize ?? null,
      p_applicant_notes: parsed.data.applicantNotes ?? null,
      p_popia_consent: parsed.data.popiaConsent,
    })
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'submission_failed', message: error.message } },
      { status: 500 },
    );
  }

  const row = data as { success: boolean; error_code: string | null; application_id: string | null };
  if (!row.success) {
    const status = row.error_code === 'consent_required' || row.error_code === 'name_required' ? 400 : 410;
    return NextResponse.json(
      { error: { code: row.error_code ?? 'submission_refused', message: 'Your application could not be submitted.' } },
      { status },
    );
  }

  return NextResponse.json({ applicationId: row.application_id });
}
