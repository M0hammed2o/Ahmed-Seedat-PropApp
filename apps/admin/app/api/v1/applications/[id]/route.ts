import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapApplicationRow } from '@/lib/leasing';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/applications/:id only -- API_SPEC.md §4 exposes no general PATCH for applications,
 * only the specific action endpoints (./consent, ./screen, ./decide) that each enforce their own
 * state-transition rules. A blanket PATCH would let a client silently overwrite e.g. `status` or
 * `decision` outside those rules.
 */
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

  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'application_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Application not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ application: mapApplicationRow(data) });
}
