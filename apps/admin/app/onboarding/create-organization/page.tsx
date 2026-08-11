import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { branding } from '@propvault/config';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { hasAcceptedCurrentLegalTerms } from '@/lib/legalConsent';
import { isProfileComplete } from '@/lib/profileCompletion';
import { mayCreatePortfolio } from '@/lib/subscriptionEntitlements';
import { Button } from '@/components/ui/Button';
import { CreateOrganizationForm } from './CreateOrganizationForm';

/**
 * TASKS.md M4 — org signup UI. First screen a signed-in user with zero organization memberships
 * lands on. Not wrapped by `(dashboard)/layout.tsx` (that layout redirects HERE for a no-org
 * user, so wrapping this page in it would loop) -- this page owns its own auth/consent/profile
 * checks instead, matching /mfa-challenge, /legal-consent, and /complete-account's own pattern of
 * standalone pages that aren't customer-layout children.
 *
 * Production signup/onboarding (WORKLOG.md this date): this page previously had NO auth check of
 * its own at all -- reachable by direct navigation even signed out, relying entirely on
 * `(dashboard)/layout.tsx`'s redirect *to* here and proxy.ts's route-prefix protection. That gap
 * also meant a not-yet-consented/not-yet-profile-complete user could reach org creation directly,
 * bypassing both new gates (unlike MFA, which proxy.ts's API-layer check still caught on submit --
 * legal-consent/profile-completion have no equivalent API-layer check, so this page-level check
 * is the only enforcement point for direct navigation here). Closed by checking all three here.
 *
 * Calls POST /api/v1/organizations, which wraps create_organization() (migration
 * 20260101000021) -- atomic org + principal membership creation.
 *
 * Forced dynamic (2026-08-02, proxy.ts's CSP-nonce fix) — same reason and split as /login.
 */
export const dynamic = 'force-dynamic';

export default async function CreateOrganizationPage() {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  if (!(await hasAcceptedCurrentLegalTerms(supabase))) {
    redirect('/legal-consent?next=%2Fonboarding%2Fcreate-organization');
  }
  if (!(await isProfileComplete(supabase))) {
    redirect('/complete-account?next=%2Fonboarding%2Fcreate-organization');
  }

  // Owner subscription + staff seat entitlement architecture (WORKLOG.md this date): a "linked
  // owner only" account (accepted someone else's owner invitation, holds zero organization
  // memberships of their own) reaching this page by direct navigation -- the natural landing flow
  // sends them to /owner-portal instead, never here (destinationResolver.ts) -- must see a clear
  // upgrade explanation, not the org-creation form. create_organization() itself still enforces
  // this server-side (migration 20260101000094); this is only the friendlier page-level message
  // for the same reason access-restricted/page.tsx exists for a suspended org's principal.
  if (!(await mayCreatePortfolio(supabase))) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
        <div className="w-full max-w-md rounded-card border border-light-border bg-light-surfaceRaised p-8 text-center shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-light-accentSoft text-light-accent dark:bg-dark-accentSoft dark:text-dark-accent">
            <ShieldAlert size={20} aria-hidden="true" />
          </span>
          <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
            Upgrade to manage your own properties
          </h1>
          <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            You can already view any property shared with you as an owner. To create and manage your
            own {branding.productName} portfolio -- your own properties, staff, and organization
            settings -- you'll need an active owner subscription.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Link href="/owner-portal">
              <Button variant="primary" className="w-full">
                Back to your shared properties
              </Button>
            </Link>
            <a href={`mailto:${branding.supportEmail}`}>
              <Button variant="secondary" className="w-full">
                Ask about an owner subscription
              </Button>
            </a>
          </div>
        </div>
      </main>
    );
  }

  return <CreateOrganizationForm />;
}
