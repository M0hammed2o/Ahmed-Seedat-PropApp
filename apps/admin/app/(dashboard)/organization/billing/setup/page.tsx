import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { PermissionDenied } from '@/components/ui/PermissionDenied';
import { CommercialSetupView } from '@/components/organizations/CommercialSetupView';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolvePortalSession } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

/**
 * GET /organization/billing/setup -- commercial plan restructure. The mandatory plan + payment
 * method setup step every new organization's principal must complete before
 * organizations.commercial_setup_completed_at is set and the trial clock starts -- see
 * destinationResolver.ts's resolveCustomerOnboardingGate() and (dashboard)/layout.tsx's own gate,
 * both of which redirect a not-yet-set-up principal here. Reachable regardless of setup state
 * (unlike every other page under this layout) -- it IS the exit from that gate.
 */
export default async function CommercialSetupPage() {
  if (ADMIN_DEMO_MODE) {
    redirect('/dashboard');
  }

  const session = await resolvePortalSession();
  const activeOrg = session?.organizations.find((m) => m.status === 'active');
  if (!session || !activeOrg) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Set up billing" />
        <PermissionDenied message="Sign in required." />
      </div>
    );
  }
  if (activeOrg.role !== 'principal') {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Set up billing" />
        <PermissionDenied message="Only the organization principal can complete billing setup." />
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('commercial_setup_completed_at')
    .eq('id', activeOrg.orgId)
    .single();

  if (orgRow?.commercial_setup_completed_at) {
    redirect('/dashboard');
  }

  const { data: planRows } = await supabase
    .from('plans')
    .select('code, name, billing_cycle, base_price, currency, feature_limits')
    .eq('is_active', true)
    .order('base_price', { ascending: true });

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Set up billing"
        subtitle="Choose a plan and add a payment method to start your 30-day free trial."
      />
      <CommercialSetupView orgId={activeOrg.orgId} plans={planRows ?? []} />
    </div>
  );
}
