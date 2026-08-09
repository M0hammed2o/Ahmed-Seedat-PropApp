import { redirect } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { hasAcceptedCurrentLegalTerms } from '@/lib/legalConsent';
import { safeNextPathOr } from '@/lib/safeRedirect';
import { LegalConsentClient } from './LegalConsentClient';

export const dynamic = 'force-dynamic';

/**
 * Production signup/onboarding (WORKLOG.md this date). Fallback consent-capture destination --
 * almost exclusively hit by OAuth users, since email/password signups already record consent at
 * RegisterForm time (POST /api/v1/auth/signup). Deliberately NOT wrapped by any of the three
 * customer layouts, matching /mfa-challenge's own reasoning exactly: if it were, the layout's own
 * gate would redirect a not-yet-consented visitor straight back here, an immediate loop.
 */
export default async function LegalConsentPage({
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

  const alreadyAccepted = await hasAcceptedCurrentLegalTerms(supabase);
  if (alreadyAccepted) redirect(next);

  return <LegalConsentClient next={next} />;
}
