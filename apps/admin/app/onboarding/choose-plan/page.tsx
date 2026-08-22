import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { branding } from '@propvault/config';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { hasAcceptedCurrentLegalTerms } from '@/lib/legalConsent';
import { isProfileComplete } from '@/lib/profileCompletion';
import { mayCreatePortfolio } from '@/lib/subscriptionEntitlements';
import { resolveTenantSession } from '@/lib/tenantSession';
import { parsePlanSelection, buildChoosePlanSelfPath } from '@/lib/planSelection';
import { Button } from '@/components/ui/Button';
import { ChoosePlanClient } from './ChoosePlanClient';

/**
 * Commercial onboarding bypass fix + entry-path preservation audit (this date). The corrected
 * landing point for every portfolio-eligible principal with zero organization memberships --
 * replaces the previous behavior of routing straight to /onboarding/create-organization, which let
 * a brand-new signup create a fully-inert org and skip plan selection + trial-activation checkout
 * entirely (see destinationResolver.ts's own comment for the full root-cause history).
 *
 * Not wrapped by (dashboard)/layout.tsx, matching /onboarding/create-organization's own
 * standalone-page pattern exactly (that layout redirects HERE for a no-org user; wrapping this
 * page in it would loop) -- this page owns its own auth/consent/profile/portfolio-eligibility
 * checks.
 *
 * `plan`/`interval` query params carry the marketing site's plan-specific CTA selection
 * (PricingSection.tsx) through registration -- validated against the fixed enum here (never
 * trusted as anything more than a UI pre-selection default; the actual price is always resolved
 * server-side by startTrialActivationCheckout() from planTier+interval alone, never from any
 * client-supplied amount). Every consent/profile bounce below re-attaches this page's OWN current
 * path+query as `next` dynamically, unlike create-organization's hardcoded
 * `?next=%2Fonboarding%2Fcreate-organization` -- this is what lets a plan-specific CTA's selection
 * survive the whole legal-consent -> complete-account round trip.
 */
export const dynamic = 'force-dynamic';

export default async function ChoosePlanPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; interval?: string }>;
}) {
  const { plan: rawPlan, interval: rawInterval } = await searchParams;
  const { tier: initialTier, interval: initialInterval } = parsePlanSelection(rawPlan, rawInterval);
  const selfPath = buildChoosePlanSelfPath({ tier: initialTier, interval: initialInterval });

  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(selfPath)}`);

  if (!(await hasAcceptedCurrentLegalTerms(supabase))) {
    redirect(`/legal-consent?next=${encodeURIComponent(selfPath)}`);
  }
  if (!(await isProfileComplete(supabase))) {
    redirect(`/complete-account?next=${encodeURIComponent(selfPath)}`);
  }

  // Same "linked owner/tenant only" guard as /onboarding/create-organization -- create_organization()
  // itself still enforces this server-side regardless; this is only the friendlier page-level
  // message, matching that page's own established pattern exactly.
  if (!(await mayCreatePortfolio(supabase))) {
    const tenantSession = await resolveTenantSession();
    const backHref = tenantSession ? '/portal' : '/owner-portal';
    const backLabel = tenantSession ? 'Back to your portal' : 'Back to your shared properties';

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
            You can already access what's been shared with you. To create and manage your own{' '}
            {branding.productName} portfolio -- your own properties, staff, and organization
            settings -- you'll need an active owner subscription.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Link href={backHref}>
              <Button variant="primary" className="w-full">
                {backLabel}
              </Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const { data: planRows } = await supabase
    .from('plans')
    .select('code, name, billing_cycle, base_price, currency, feature_limits')
    .eq('is_active', true)
    .order('base_price', { ascending: true });

  return (
    <ChoosePlanClient
      plans={planRows ?? []}
      initialTier={initialTier}
      initialInterval={initialInterval}
    />
  );
}
