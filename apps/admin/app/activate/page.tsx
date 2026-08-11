import { redirect } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { hasAcceptedCurrentLegalTerms } from '@/lib/legalConsent';
import { isProfileComplete } from '@/lib/profileCompletion';
import { ActivateClient } from './ActivateClient';

// Forced dynamic, same reason as /login and /register: proxy.ts's per-request CSP nonce.
// Deliberately NOT in proxy.ts's PROTECTED_ROUTE_PREFIXES -- a brand-new tenant is not signed in
// yet when they first open this link (PRODUCT DECISION 2), this page's own client-side branches
// on session state instead of relying on the proxy redirect gate.
export const dynamic = 'force-dynamic';

/**
 * Tenant onboarding completion pass (WORKLOG.md this date). Server-side gate ahead of
 * ActivateClient, mirroring /complete-account's and /legal-consent's own pattern exactly (same
 * order: consent, then profile) -- closes the audit's "IMPORTANT INVITATION ORDER" gap: an
 * authenticated caller with incomplete required account details previously reached
 * ActivateClient's auto-accept effect immediately, linking a genuinely incomplete account.
 *
 * Only fires for an authenticated caller -- a signed-out visitor is unaffected (ActivateClient's
 * own signed-out branch is unchanged, offering sign-in/create-account first). Both redirect
 * targets (/legal-consent, /complete-account) send `next` straight back to this exact
 * `/activate?token=...` path once satisfied, so this can never loop: neither of those pages has
 * any tenant-invitation awareness of its own, and both dead-end at "redirect to next" once their
 * own single condition is met.
 *
 * Deliberately does NOT itself call accept_tenant_invitation() -- ActivateClient still owns that,
 * now guaranteed to only ever run for an authenticated caller who already has current legal
 * consent AND a complete profile, satisfying "verify profile completion before accepting the
 * invitation, not after" for both a brand-new signup and a pre-existing, still-incomplete account.
 */
export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const currentPath = token ? `/activate?token=${encodeURIComponent(token)}` : '/activate';

  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    const supabase = await getServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      if (!(await hasAcceptedCurrentLegalTerms(supabase))) {
        redirect(`/legal-consent?next=${encodeURIComponent(currentPath)}`);
      }
      if (!(await isProfileComplete(supabase))) {
        redirect(`/complete-account?next=${encodeURIComponent(currentPath)}`);
      }
    }
  }

  return <ActivateClient />;
}
