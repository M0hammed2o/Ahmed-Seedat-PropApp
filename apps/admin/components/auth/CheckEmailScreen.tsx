'use client';

import { useEffect, useState } from 'react';
import { ProplystLogo } from '@/components/branding/ProplystLogo';
import { Button } from '@/components/ui/Button';

const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Production signup/onboarding (WORKLOG.md this date). The branded "Check your email" screen,
 * extracted from RegisterForm.tsx's own previously-inline version so it can also gain a real
 * Resend control -- the prior version was a dead end with no way to recover from a lost/expired
 * email short of restarting signup entirely. Deliberately does NOT rewrite the underlying
 * confirmation-link mechanism (a known, separate architectural question, out of scope here) --
 * only the surrounding UX for the ordinary "I didn't get the email" / "I mistyped my email" cases.
 */
export function CheckEmailScreen({
  email,
  next,
  onBackToSignup,
}: {
  email: string;
  next: string;
  onBackToSignup: () => void;
}) {
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleResend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setResendMessage(null);
    try {
      const response = await fetch('/api/v1/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, next }),
      });
      if (response.status === 429) {
        setResendMessage('Too many attempts. Try again shortly.');
      } else {
        // Always the same message regardless of the response body -- matches the route's own
        // anti-enumeration posture (it never reveals whether the address exists or is already
        // confirmed), so the UI must not either.
        setResendMessage('If that address needs a new link, we just sent one.');
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch {
      setResendMessage('Could not resend — check your connection and try again.');
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 text-center shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
        <div className="mx-auto flex justify-center">
          <ProplystLogo />
        </div>
        <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          Check your email
        </h1>
        <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          We sent a verification link to
        </p>
        <p className="mt-1 break-all text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
          {email}
        </p>
        <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Click the link to confirm your account. Already confirmed?{' '}
          <a href="/login" className="text-light-accent hover:underline dark:text-dark-accent">
            Sign in
          </a>
          .
        </p>

        {resendMessage ? (
          <p className="mt-4 text-xs text-light-textSecondary dark:text-dark-textSecondary">
            {resendMessage}
          </p>
        ) : null}

        <Button
          type="button"
          variant="secondary"
          onClick={handleResend}
          disabled={resending || cooldown > 0}
          className="mt-4 w-full"
        >
          {cooldown > 0
            ? `Resend verification email (${cooldown}s)`
            : resending
              ? 'Sending…'
              : 'Resend verification email'}
        </Button>

        <button
          type="button"
          onClick={onBackToSignup}
          className="mt-3 text-xs text-light-textSecondary underline hover:text-light-textPrimary dark:text-dark-textSecondary dark:hover:text-dark-textPrimary"
        >
          Wrong email? Back to sign up
        </button>
      </div>
    </main>
  );
}
