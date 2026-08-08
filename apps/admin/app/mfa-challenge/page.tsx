import { redirect } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireCustomerMfaIfEnrolled } from '@/lib/mfaGate';
import { safeNextPathOr } from '@/lib/safeRedirect';
import { MfaChallengeClient } from './MfaChallengeClient';

export const dynamic = 'force-dynamic';

/**
 * Dedicated destination for completing an already-in-progress MFA step-up later, without
 * re-entering a password -- Stage 3 customer MFA bypass fix, explicit UX requirement (WORKLOG.md
 * this date): a customer who authenticated with the correct password, was shown the inline
 * challenge in LoginForm.tsx, but navigated away (or was redirected here from a protected layout
 * after attempting a direct URL) must be able to finish the SAME AAL1 session's step-up here, not
 * be forced to sign in again. `(dashboard)`/`(owner)`/`(tenant)` layouts redirect here (with
 * `next` preserving the originally-attempted destination) instead of `/login` when
 * `requireCustomerMfaIfEnrolled()` is true.
 *
 * Deliberately NOT wrapped by any of the three customer layouts -- if it were, the layout's own
 * gate would redirect a not-yet-stepped-up visitor straight back here, an immediate loop.
 */
export default async function MfaChallengePage({
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

  const needsStepUp = await requireCustomerMfaIfEnrolled();
  if (!needsStepUp) {
    // Nothing to challenge -- either no factor is enrolled, or this session already reached AAL2
    // (e.g. completed in another tab). Never show a pointless challenge screen; just continue.
    redirect(next);
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const factorId = factorsData?.totp?.[0]?.id;
  if (!factorId) {
    // Same inconsistent-state guard POST /api/v1/auth/signin already applies: the AAL requirement
    // says aal2 but no listable factor exists. Fails closed to /login rather than guessing.
    redirect('/login');
  }

  return <MfaChallengeClient factorId={factorId} next={next} />;
}
