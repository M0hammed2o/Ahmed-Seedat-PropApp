import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { branding } from '@propvault/config';
import { resolvePortalSession } from '@/lib/orgSession';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/Button';

export const dynamic = 'force-dynamic';

// Reached via resolveAuthenticatedDestination()'s 'org-restricted' case: every active org
// membership this caller holds belongs to a suspended or cancelled organization. A truthful
// account-state page, not a generic error -- the caller did nothing wrong and needs to know
// exactly what happened and what to do next (reactivate billing), not a vague "access denied."
export default async function AccessRestrictedPage() {
  const portalSession = await resolvePortalSession();
  const restrictedMembership = portalSession?.organizations.find(
    (m) => m.status === 'active' && (m.orgStatus === 'suspended' || m.orgStatus === 'cancelled'),
  );

  // Reached this page with nothing actually restricted (e.g. billing was reactivated between the
  // redirect and this render) -- send back through the resolver rather than showing a stale page.
  if (!restrictedMembership) {
    redirect('/');
  }

  const supabase = await getServerSupabaseClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('legal_name')
    .eq('id', restrictedMembership.orgId)
    .maybeSingle();

  const isCancelled = restrictedMembership.orgStatus === 'cancelled';

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-md rounded-card border border-light-border bg-light-surfaceRaised p-8 text-center shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-light-danger/10 text-light-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          <ShieldAlert size={20} aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          {isCancelled ? 'Subscription cancelled' : 'Access temporarily restricted'}
        </h1>
        <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          {org?.legal_name ? `${org.legal_name}'s` : 'Your organization’s'} {branding.productName}{' '}
          subscription {isCancelled ? 'has been cancelled' : 'is overdue'}, so access to your
          dashboard is paused. Your data is safe and nothing has been deleted.
        </p>
        <p className="mt-4 text-xs text-light-textMuted dark:text-dark-textMuted">
          Only an organization principal can reactivate billing. If that isn't you, contact your
          organization's principal.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/organization/billing">
            <Button variant="primary" className="w-full">
              Manage billing
            </Button>
          </Link>
          <a href={`mailto:${branding.supportEmail}`}>
            <Button variant="secondary" className="w-full">
              Contact support
            </Button>
          </a>
        </div>
      </div>
    </main>
  );
}
