import { redirect } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { isProfileComplete } from '@/lib/profileCompletion';
import { safeNextPathOr } from '@/lib/safeRedirect';
import { CompleteAccountClient } from './CompleteAccountClient';

export const dynamic = 'force-dynamic';

/**
 * Production signup/onboarding (WORKLOG.md this date). Collects first/last name and phone number
 * after first authentication, before organization creation -- neither RegisterForm nor OAuth
 * ever collects these. Deliberately NOT wrapped by any of the three customer layouts, matching
 * /mfa-challenge and /legal-consent's own reasoning: a layout-level gate would redirect a
 * not-yet-complete visitor straight back here, an immediate loop. `next` (and, inside it, any
 * pending invitation token) is preserved end-to-end -- this screen never destroys that
 * continuation, it only interposes before it.
 */
export default async function CompleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPathOr(rawNext, '/');

  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const complete = await isProfileComplete(supabase);
  if (complete) redirect(next);

  return <CompleteAccountClient next={next} />;
}
