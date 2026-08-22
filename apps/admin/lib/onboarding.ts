import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface OnboardingStep {
  id: string;
  label: string;
  completed: boolean;
  skippable: boolean;
  skipped: boolean;
  href: string;
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  percentComplete: number;
  /** First step that is neither completed nor skipped -- null once everything is done/skipped. */
  currentStep: OnboardingStep | null;
  allDone: boolean;
  /** V1 commercial UX pass -- the interactive walkthrough's own persisted state (distinct from the
   * checklist above). Surfaced here so the walkthrough engine (client-side) knows whether to
   * auto-show itself on first load without a second round trip. */
  walkthroughDismissed: boolean;
  walkthroughCompleted: boolean;
}

/**
 * V1 commercial onboarding pass, Phase 4 -- the guided onboarding engine. Deliberately resolves
 * every step from REAL system state (properties/units/tenants/leases/staff/payment
 * method/commercial setup existing or not) rather than a stored, independently-fallible
 * "onboarding_completed" flag -- see 20260101000119_guided_onboarding.sql's own comment for why.
 * A property created through any path (not just the guided flow) correctly marks that step
 * done; nothing here can drift out of sync with what the org actually has.
 *
 * Commercial-setup steps (plan/payment method) are only included for an org that
 * commercial_setup_required (a genuine post-restructure self-service signup) -- a grandfathered
 * pre-existing organization, which may have zero organization_subscriptions/payment_methods rows
 * simply because it predates this system entirely, is never nagged to "choose a plan" it already
 * effectively has.
 */
export async function resolveOnboardingProgress(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OnboardingProgress> {
  const [
    { data: org },
    { data: onboardingState },
    { count: propertyCount },
    { count: unitCount },
    { count: tenantCount },
    { count: leaseCount },
    { count: invitesCount },
    { count: memberCount },
    { data: paymentMethod },
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select('commercial_setup_required, commercial_setup_completed_at')
      .eq('id', orgId)
      .single(),
    supabase.from('organization_onboarding_state').select('*').eq('org_id', orgId).maybeSingle(),
    supabase.from('properties').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase.from('units').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase.from('tenants').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase.from('leases').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase
      .from('organization_invites')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId),
    supabase
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'active')
      .neq('role', 'principal'),
    supabase
      .from('payment_methods')
      .select('id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle(),
  ]);

  const needsCommercialSetup = org?.commercial_setup_required === true;
  const staffExists = (invitesCount ?? 0) > 0 || (memberCount ?? 0) > 0;
  const staffSkipped = Boolean(onboardingState?.staff_step_skipped_at);

  const steps: OnboardingStep[] = [
    {
      id: 'confirm_email',
      label: 'Confirm your email',
      completed: true, // reaching any org-scoped resolver at all requires a confirmed session
      skippable: false,
      skipped: false,
      href: '/dashboard',
    },
    ...(needsCommercialSetup
      ? [
          {
            id: 'choose_plan' as const,
            label: 'Choose your plan',
            completed: Boolean(org?.commercial_setup_completed_at),
            skippable: false,
            skipped: false,
            href: '/organization/billing/setup',
          },
          {
            id: 'payment_method' as const,
            label: 'Add a payment method',
            completed: Boolean(paymentMethod) || Boolean(org?.commercial_setup_completed_at),
            skippable: false,
            skipped: false,
            href: '/organization/billing/setup',
          },
        ]
      : []),
    {
      id: 'invite_staff',
      label: 'Invite your team',
      completed: staffExists,
      skippable: true,
      skipped: staffSkipped && !staffExists,
      href: '/organization/staff',
    },
    {
      id: 'first_property',
      label: 'Add your first property',
      completed: (propertyCount ?? 0) > 0,
      skippable: false,
      skipped: false,
      href: '/properties/new',
    },
    {
      id: 'first_unit',
      label: 'Add your first unit',
      completed: (unitCount ?? 0) > 0,
      skippable: false,
      skipped: false,
      href: '/properties',
    },
    {
      id: 'first_tenant',
      label: 'Add your first tenant',
      completed: (tenantCount ?? 0) > 0,
      skippable: false,
      skipped: false,
      href: '/tenants/new',
    },
    {
      id: 'first_lease',
      label: 'Create your first lease',
      completed: (leaseCount ?? 0) > 0,
      skippable: false,
      skipped: false,
      href: '/leases',
    },
    {
      id: 'review_payments',
      label: 'Review payments',
      completed: Boolean(onboardingState?.viewed_payments_intro_at),
      skippable: true,
      skipped: false,
      href: '/reports',
    },
    {
      id: 'explore_documents',
      label: 'Explore documents & maintenance',
      completed: Boolean(onboardingState?.viewed_documents_intro_at),
      skippable: true,
      skipped: false,
      href: '/documents',
    },
  ];

  const doneOrSkipped = steps.filter((s) => s.completed || s.skipped).length;
  const percentComplete = Math.round((doneOrSkipped / steps.length) * 100);
  const currentStep = steps.find((s) => !s.completed && !s.skipped) ?? null;

  return {
    steps,
    percentComplete,
    currentStep,
    allDone: currentStep === null,
    walkthroughDismissed: Boolean(onboardingState?.walkthrough_dismissed_at),
    walkthroughCompleted: Boolean(onboardingState?.walkthrough_completed_at),
  };
}

/** Marks the staff-invitation step explicitly skipped (agent+, upserted -- see migration's own
 * RLS comment for why this isn't principal-only). Idempotent: re-skipping is a harmless no-op. */
export async function skipStaffOnboardingStep(
  supabase: SupabaseClient,
  orgId: string,
): Promise<void> {
  await supabase
    .from('organization_onboarding_state')
    .upsert({ org_id: orgId, staff_step_skipped_at: new Date().toISOString() }, { onConflict: 'org_id' });
}

/** Marks a "viewed" onboarding intro step (payments or documents) the first time its section is
 * genuinely opened -- idempotent, safe to call on every visit (only ever sets the timestamp once
 * per org, via coalesce-equivalent upsert semantics: a later call with the same column simply
 * overwrites with a newer "still viewed" timestamp, never un-marks it). */
export async function markOnboardingIntroViewed(
  supabase: SupabaseClient,
  orgId: string,
  intro: 'payments' | 'documents',
): Promise<void> {
  const column = intro === 'payments' ? 'viewed_payments_intro_at' : 'viewed_documents_intro_at';
  await supabase
    .from('organization_onboarding_state')
    .upsert({ org_id: orgId, [column]: new Date().toISOString() }, { onConflict: 'org_id' });
}

/** Marks the interactive first-use walkthrough dismissed or completed -- distinct from the
 * checklist above (a UI preference, not a system-state fact), stored because it genuinely cannot
 * be derived from anything else. `restart` clears BOTH timestamps so the walkthrough shows again
 * from step one ("Restart guided tour" in Settings) -- deliberately never triggered automatically
 * on its own; only an explicit user action calls this. */
export async function setWalkthroughState(
  supabase: SupabaseClient,
  orgId: string,
  state: 'dismissed' | 'completed' | 'restart',
): Promise<void> {
  if (state === 'restart') {
    await supabase
      .from('organization_onboarding_state')
      .upsert(
        { org_id: orgId, walkthrough_dismissed_at: null, walkthrough_completed_at: null },
        { onConflict: 'org_id' },
      );
    return;
  }
  const column = state === 'dismissed' ? 'walkthrough_dismissed_at' : 'walkthrough_completed_at';
  await supabase
    .from('organization_onboarding_state')
    .upsert({ org_id: orgId, [column]: new Date().toISOString() }, { onConflict: 'org_id' });
}
