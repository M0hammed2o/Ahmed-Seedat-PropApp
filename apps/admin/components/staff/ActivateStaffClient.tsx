'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type Status = 'pending' | 'success' | 'error';

/**
 * Provisioned-staff account model (this date): the authenticated final step of /staff/activate,
 * reached only once password/legal-consent/profile-completion are all already satisfied (see
 * app/staff/activate/page.tsx's own gate ordering). Auto-fires POST /api/v1/staff/activate/finish
 * on mount, mirroring AcceptInviteClient.tsx exactly -- that route resolves and activates the
 * caller's own pending provision via `auth.uid()` alone, no token carried this far.
 */
export function ActivateStaffClient() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/staff/activate/finish', { method: 'POST' })
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setStatus('error');
          setMessage(body.error?.message ?? 'Failed to activate your account.');
          return;
        }
        setStatus('success');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
          setMessage('Failed to activate your account — check your connection and try again.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
              Activating your account…
            </h1>
            <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              This will only take a moment.
            </p>
          </>
        ) : null}

        {status === 'success' ? (
          <>
            <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
              You're in
            </h1>
            <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Your account is active. Redirecting you to your dashboard.
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
              Couldn't activate your account
            </h1>
            <p className="mt-1 text-sm text-light-danger dark:text-dark-danger">{message}</p>
            <p className="mt-3 text-xs text-light-textMuted dark:text-dark-textMuted">
              This link may have expired or already been used. Contact whoever added you for a new
              one.
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
