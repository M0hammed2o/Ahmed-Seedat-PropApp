import Link from 'next/link';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { AcceptInviteClient } from '@/components/invitations/AcceptInviteClient';
import { Button } from '@/components/ui/Button';
import { ProplystLogo } from '@/components/branding/ProplystLogo';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

export const dynamic = 'force-dynamic';

type SearchParams = { searchParams: Promise<{ token?: string }> };

// GET /invitations/accept?token=... -- Blocker #3, PWA_V1_COMPLETION_PLAN.md. Public route
// (not in proxy.ts's PROTECTED_ROUTE_PREFIXES): the caller may not be signed in yet when they
// click the link from their invite email, so this page itself branches on auth state rather than
// relying on the proxy redirect gate.
export default async function AcceptInvitePage({ searchParams }: SearchParams) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <CenteredCard title="Invalid invitation link">
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          This link is missing its invitation token. Ask whoever invited you to resend it.
        </p>
      </CenteredCard>
    );
  }

  if (ADMIN_DEMO_MODE) {
    return (
      <CenteredCard title="Not available in demo mode">
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Invitations require a live Supabase project. Turn off demo mode to test this flow.
        </p>
      </CenteredCard>
    );
  }

  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // PRODUCT DECISION 1 (2026-08-03): "invitation continuation after authentication" -- carry
    // this exact invitation URL through sign-in/registration via ?next=, rather than the bare
    // /login this used to link to (which silently dropped the token, stranding the invitee on a
    // generic dashboard after signing in with no way back to this page except re-finding the
    // original email).
    const currentPath = `/invitations/accept?token=${encodeURIComponent(token)}`;
    return (
      <CenteredCard title="Sign in to accept this invitation">
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          You need to be signed in with the email address this invitation was sent to.
        </p>
        <div className="mt-6 space-y-2">
          <Link href={`/login?next=${encodeURIComponent(currentPath)}`} className="block">
            <Button variant="primary" className="w-full">
              Sign in
            </Button>
          </Link>
          <Link href={`/register?next=${encodeURIComponent(currentPath)}`} className="block">
            <Button className="w-full">Create an account</Button>
          </Link>
        </div>
      </CenteredCard>
    );
  }

  return <AcceptInviteClient token={token} />;
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
