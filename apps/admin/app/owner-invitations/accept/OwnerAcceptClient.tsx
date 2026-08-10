'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Building2, CheckCircle2, XCircle } from 'lucide-react';
import { branding } from '@propvault/config';
import { getBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';

type Stage = 'checking-session' | 'signed-out' | 'confirming' | 'no-token' | 'success' | 'error';

/**
 * OWNER UI (shared-access architecture pass, WORKLOG.md this date). Mirrors
 * app/activate/ActivateClient.tsx (the tenant equivalent) -- token-only, no short-code entry
 * (see OwnerInvitation's own comment for why an owner invitation never needs one). Never renders
 * any property/financial data itself -- this page's only job is turning a token into a linked
 * account via POST /api/v1/owner-invitations/accept, then handing off to the real owner portal.
 */
export function OwnerAcceptClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [stage, setStage] = useState<Stage>('checking-session');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const currentPath = token
    ? `/owner-invitations/accept?token=${encodeURIComponent(token)}`
    : '/owner-invitations/accept';

  useEffect(() => {
    if (!token) {
      setStage('no-token');
      return;
    }
    if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
      setStage('signed-out');
      return;
    }
    const supabase = getBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        setStage('signed-out');
        return;
      }
      void accept(token);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once on mount
  }, []);

  async function accept(t: string) {
    setStage('confirming');
    setErrorMessage(null);
    try {
      const response = await fetch('/api/v1/owner-invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      });
      const responseBody = await response.json();
      if (!response.ok) {
        setErrorMessage(responseBody.error?.message ?? 'This invitation could not be accepted.');
        setStage('error');
        return;
      }
      setStage('success');
    } catch {
      setErrorMessage('Failed to accept — check your connection and try again.');
      setStage('error');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 text-center shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
          <Building2 size={20} aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          {branding.productName}
        </h1>

        {stage === 'checking-session' || stage === 'confirming' ? (
          <p className="mt-3 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            Linking your account…
          </p>
        ) : null}

        {stage === 'no-token' ? (
          <p className="mt-3 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            This link is missing its invitation token. Ask the property manager to resend it.
          </p>
        ) : null}

        {stage === 'signed-out' ? (
          <>
            <p className="mt-3 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Sign in or create an account to link your owner access.
            </p>
            <div className="mt-6 space-y-2">
              <Link href={`/login?next=${encodeURIComponent(currentPath)}`}>
                <Button variant="primary" className="w-full">
                  Sign in
                </Button>
              </Link>
              <Link href={`/register?next=${encodeURIComponent(currentPath)}`}>
                <Button className="w-full">Create an account</Button>
              </Link>
            </div>
          </>
        ) : null}

        {stage === 'success' ? (
          <>
            <CheckCircle2
              size={32}
              className="mx-auto mt-4 text-light-statusPaid dark:text-dark-statusPaid"
              aria-hidden="true"
            />
            <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Your account is now linked. You can see the properties you own.
            </p>
            <Button
              variant="primary"
              className="mt-4 w-full"
              onClick={() => router.replace('/owner-portal')}
            >
              Go to my portal
            </Button>
          </>
        ) : null}

        {stage === 'error' ? (
          <>
            <XCircle
              size={32}
              className="mx-auto mt-4 text-light-danger dark:text-dark-danger"
              aria-hidden="true"
            />
            <p className="mt-2 text-sm text-light-danger dark:text-dark-danger">{errorMessage}</p>
            <p className="mt-3 text-xs text-light-textMuted dark:text-dark-textMuted">
              If this keeps happening, contact the property manager for help.
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
