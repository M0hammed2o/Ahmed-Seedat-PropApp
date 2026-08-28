import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/safeError';

type RouteParams = { params: Promise<{ token: string }> };

interface TokenApplicationRow {
  valid: boolean;
  error_code: string | null;
  application_id: string | null;
  org_id: string | null;
  property_id: string | null;
  unit_id: string | null;
  status: string | null;
  applicant_name: string | null;
  applicant_email: string | null;
  applicant_phone: string | null;
  date_of_birth: string | null;
  current_address: string | null;
  employment_status: string | null;
  employer_name: string | null;
  monthly_income: number | null;
  household_size: number | null;
  applicant_notes: string | null;
  popia_consent_at: string | null;
  property_nickname: string | null;
  unit_label: string | null;
}

/**
 * GET /api/v1/apply/:token (Phase 4-7, migration 20260101000132). Fully public -- no session, no
 * cookie, no bearer token. Authorization is entirely the possession of a valid, unexpired,
 * unrevoked token, checked server-side by get_application_by_token() (SECURITY DEFINER). Uses the
 * plain anon-key client (getServerSupabaseClient() with no session present resolves to exactly
 * that) since there is deliberately no auth.users identity for an applicant to sign in as.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { token } = await params;
  const supabase = await getServerSupabaseClient();

  const { data, error } = await supabase
    .rpc('get_application_by_token', { p_token: token })
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'application_lookup_failed',
          message: safeErrorMessage(error, 'Could not load this application link.', 'apply.lookup'),
        },
      },
      { status: 500 },
    );
  }

  const row = data as TokenApplicationRow;
  if (!row.valid) {
    return NextResponse.json(
      { error: { code: row.error_code ?? 'invalid_token', message: 'This link is no longer valid.' } },
      { status: 410 },
    );
  }

  // application_document_requirements has no applicant-facing RLS grant at all (staff-only) --
  // the requirement list is fetched via this token-authenticated RPC instead, never a direct
  // table read.
  const { data: requirementRows } = await supabase.rpc('get_application_document_requirements_by_token', {
    p_token: token,
  });
  const documentRequirements = (
    (requirementRows ?? []) as {
      requirement_key: string;
      label: string;
      is_required: boolean;
      status: string;
      rejection_reason: string | null;
      document_id: string | null;
    }[]
  ).map((r) => ({
    requirementKey: r.requirement_key,
    label: r.label,
    isRequired: r.is_required,
    status: r.status,
    rejectionReason: r.rejection_reason,
    documentId: r.document_id,
  }));

  return NextResponse.json({
    application: {
      id: row.application_id,
      status: row.status,
      applicantName: row.applicant_name,
      applicantEmail: row.applicant_email,
      applicantPhone: row.applicant_phone,
      dateOfBirth: row.date_of_birth,
      currentAddress: row.current_address,
      employmentStatus: row.employment_status,
      employerName: row.employer_name,
      monthlyIncome: row.monthly_income,
      householdSize: row.household_size,
      applicantNotes: row.applicant_notes,
      popiaConsentAt: row.popia_consent_at,
      propertyNickname: row.property_nickname,
      unitLabel: row.unit_label,
    },
    documentRequirements,
  });
}
