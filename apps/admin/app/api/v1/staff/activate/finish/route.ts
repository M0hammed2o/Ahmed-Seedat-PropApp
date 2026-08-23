import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/**
 * POST /api/v1/staff/activate/finish -- the authenticated last step of the provisioned-staff
 * activation flow (called by ActivateStaffClient after password/legal-consent/profile-completion
 * are all already satisfied, mirroring AcceptInviteClient's own auto-fire-on-mount pattern).
 *
 * Takes no body: `activate_staff_provision()` (migration 20260101000124) resolves the caller's own
 * pending row via `auth.uid()` alone -- no client-supplied provision id or token, so there is
 * nothing here to trust from the request beyond the caller's own session, exactly matching
 * accept_organization_invite()'s own established shape.
 */
export async function POST() {
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

  const { data, error } = await supabase.rpc('activate_staff_provision');
  if (error) {
    const message = error.message ?? 'Failed to activate your account.';
    return NextResponse.json(
      { error: { code: 'activation_failed', message } },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, orgId: data });
}
