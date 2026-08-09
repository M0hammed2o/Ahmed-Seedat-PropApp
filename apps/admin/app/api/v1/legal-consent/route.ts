import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { rateLimitOrRespond } from '@/lib/rateLimit';
import { recordLegalConsent } from '@/lib/legalConsent';

/**
 * POST /api/v1/legal-consent -- the fallback consent-capture step for anyone who reaches an
 * authenticated page without a recorded acceptance (WORKLOG.md this date). In practice this is
 * almost always an OAuth user: they never see RegisterForm's checkboxes at all, since
 * `/auth/callback` never routes through registration. Takes no body -- there is nothing for the
 * client to submit beyond "I agree" (a boolean intent expressed by which button was pressed);
 * the actual recorded version always comes from the server's own TERMS_VERSION/PRIVACY_VERSION,
 * never a client-supplied string, exactly like the signup route's own write path.
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

  const limited = await rateLimitOrRespond(supabase, `legal-consent:user:${user.id}`, 10, 60);
  if (limited) return limited;

  await recordLegalConsent(user.id);

  return NextResponse.json({ accepted: true });
}
