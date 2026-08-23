import { redirect } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { hasAcceptedCurrentLegalTerms } from '@/lib/legalConsent';
import { isProfileComplete } from '@/lib/profileCompletion';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { ProplystLogo } from '@/components/branding/ProplystLogo';
import { SetPasswordClient } from '@/components/staff/SetPasswordClient';
import { ActivateStaffClient } from '@/components/staff/ActivateStaffClient';

export const dynamic = 'force-dynamic';

const CURRENT_PATH = '/staff/activate';

/**
 * GET /staff/activate?token_hash=...&type=invite -- provisioned-staff account model (this date).
 * Public route (not in proxy.ts's PROTECTED_ROUTE_PREFIXES), same reasoning as /invitations/accept
 * and /activate: the employee is not signed in yet on first visit, so this page branches on
 * session state itself rather than relying on the proxy redirect gate.
 *
 * Order mirrors /activate/page.tsx exactly (set credential -> legal consent -> profile completion
 * -> the actual grant), extended one step earlier: unlike a tenant/owner accept link (which is
 * already an authenticated continuation by the time it reaches its own gate), this link starts
 * genuinely unauthenticated, so SetPasswordClient's job is turning `token_hash` into a session
 * BEFORE any of the existing consent/profile gates can apply.
 *
 * Deliberately does NOT call activate_staff_provision() itself -- ActivateStaffClient does, once
 * every earlier gate has already passed, so the RPC only ever runs for a caller who is
 * authenticated, has current legal consent, and a complete profile.
 */
export default async function StaffActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash: tokenHash } = await searchParams;

  if (ADMIN_DEMO_MODE) {
    return (
      <CenteredCard title="Not available in demo mode">
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Staff activation requires a live Supabase project. Turn off demo mode to test this flow.
        </p>
      </CenteredCard>
    );
  }

  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (!tokenHash) {
      return (
        <CenteredCard title="Invalid activation link">
          <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            This link is missing its activation token. Ask whoever added you to resend it.
          </p>
        </CenteredCard>
      );
    }
    return <SetPasswordClient tokenHash={tokenHash} />;
  }

  if (!(await hasAcceptedCurrentLegalTerms(supabase))) {
    redirect(`/legal-consent?next=${encodeURIComponent(CURRENT_PATH)}`);
  }
  if (!(await isProfileComplete(supabase))) {
    redirect(`/complete-account?next=${encodeURIComponent(CURRENT_PATH)}`);
  }

  return <ActivateStaffClient />;
}

function CenteredCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 text-center shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
        <div className="mx-auto flex justify-center">
          <ProplystLogo />
        </div>
        <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}
