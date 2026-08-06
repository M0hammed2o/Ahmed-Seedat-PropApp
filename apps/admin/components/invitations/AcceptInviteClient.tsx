'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type Status = 'pending' | 'success' | 'error';

// Blocker #3, PWA_V1_COMPLETION_PLAN.md: POST /api/v1/organizations/invites/accept existed with
// no UI ever calling it. This is the missing piece -- the parent Server Component already
// confirmed the caller is signed in before rendering this.
export function AcceptInviteClient({ token }: { token: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/organizations/invites/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setStatus('error');
          setMessage(body.error?.message ?? 'Failed to accept the invitation.');
          return;
        }
        setStatus('success');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
          setMessage('Failed to accept the invitation — check your connection and try again.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (status !== 'success') return;
    const timer = setTimeout(() => {
      router.replace('/');
      router.refresh();
    }, 1500);
    return () => clearTimeout(timer);
  }, [status, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 text-center shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
          <Building2 size={20} aria-hidden="true" />
        </span>

        {status === 'pending' ? (
          <>
            <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
              Joining organization…
            </h1>
            <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Accepting your invitation.
            </p>
          </>
        ) : null}

        {status === 'success' ? (
          <>
            <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
              You're in
            </h1>
            <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Invitation accepted. Redirecting you to your dashboard.
            </p>
            <Button
              variant="primary"
              className="mt-6 w-full"
              onClick={() => {
                router.replace('/');
                router.refresh();
              }}
            >
              Continue now
            </Button>
          </>
        ) : null}

        {status === 'error' ? (
          <>
            <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
              Couldn't accept this invitation
            </h1>
            <p className="mt-1 text-sm text-light-danger dark:text-dark-danger">{message}</p>
            <p className="mt-3 text-xs text-light-textMuted dark:text-dark-textMuted">
              The invite may have expired, already been used, or been addressed to a different email
              address than the one you're signed in with.
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
