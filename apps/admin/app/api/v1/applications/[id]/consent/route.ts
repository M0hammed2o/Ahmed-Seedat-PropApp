import { NextResponse, type NextRequest } from 'next/server';
import { applicationConsentSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapApplicationRow } from '@/lib/leasing';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/applications/:id/consent (API_SPEC.md §4: "POPIA + screening consent capture").
 * Sets whichever consent timestamp(s) the caller provides to now() -- consent is a point-in-time
 * fact being recorded, never client-suppliable as an arbitrary timestamp (that would let a client
 * backdate consent), and never un-set once given (no way to clear a *_consent_at via this
 * endpoint -- consent, once captured, is a permanent record, not a toggle).
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
    .select('org_id')
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
          message: 'You do not have permission to record consent for this application.',
        },
      },
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

  const parsed = applicationConsentSchema.safeParse(body);
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
  const now = new Date().toISOString();
  if (parsed.data.popiaConsent === true) patch.popia_consent_at = now;
  if (parsed.data.screeningConsent === true) patch.screening_consent_at = now;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      {
        error: {
          code: 'no_op',
          message: 'At least one consent flag must be set to true to record consent.',
        },
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('applications')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'consent_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ application: mapApplicationRow(data) });
}
