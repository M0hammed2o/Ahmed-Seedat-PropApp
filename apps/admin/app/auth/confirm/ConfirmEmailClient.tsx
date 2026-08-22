'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ProplystLogo } from '@/components/branding/ProplystLogo';
import { Button } from '@/components/ui/Button';

type ConfirmState =
  'idle' | 'confirming' | 'success' | 'already_confirmed' | 'used_or_expired' | 'invalid';

/**
 * The explicit user action this whole flow exists for (WORKLOG.md this date) -- GET-ing
 * /auth/confirm (app/auth/confirm/page.tsx) never calls verifyOtp(); only a real click on the
 * button below does, via POST /api/v1/auth/confirm. This is what makes the link safe against
 * email security scanners and link-preview fetchers, which only ever issue a GET.
 *
 * Staff invitation flow audit (this date): `next` is already fully resolved and safety-validated
 * by the parent Server Component (safeNextPathOr against the extracted inner RedirectTo path) --
 * this component only ever navigates to it, never re-derives or re-trusts it itself.
 */
export function ConfirmEmailClient({
  tokenHash,
  next,
}: {
  tokenHash: string | null;
  next: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<ConfirmState>(tokenHash ? 'idle' : 'invalid');
  const [resendEmail, setResendEmail] = useState('');
  const [resendSubmitted, setResendSubmitted] = useState(false);

  async function handleConfirm() {
    if (!tokenHash || state === 'confirming') return;
    setState('confirming');
    try {
      const response = await fetch('/api/v1/auth/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenHash, type: 'signup' }),
      });
      const body = (await response.json()) as { outcome: ConfirmState };
      setState(body.outcome);
    } catch {
      setState('used_or_expired');
    }
  }

  function handleContinue() {
    router.replace(next);
    router.refresh();
  }

  async function handleResend(e: FormEvent) {
    e.preventDefault();
    if (!resendEmail) return;
    try {
      await fetch('/api/v1/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail }),
      });
    } catch {
      // Same anti-enumeration posture as CheckEmailScreen.tsx's own resend handler -- the outcome
      // is shown identically regardless of whether the request actually succeeded server-side.
    }
    setResendSubmitted(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 text-center shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
        <div className="mx-auto flex justify-center">
          <ProplystLogo />
        </div>

        {(state === 'idle' || state === 'confirming') && (
          <>
            <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
              Confirm your email address
            </h1>
            <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Your email address is ready to be verified.
            </p>
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirm}
              disabled={state === 'confirming'}
              className="mt-6 w-full"
            >
              {state === 'confirming' ? 'Confirming…' : 'Confirm email address'}
            </Button>
          </>
        )}

        {state === 'success' && (
          <>
            <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
              Email confirmed
            </h1>
            <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Your email address has been verified successfully.
            </p>
            <Button
              type="button"
              variant="primary"
              onClick={handleContinue}
              className="mt-6 w-full"
            >
              Continue to Proplyst
            </Button>
          </>
        )}

        {state === 'already_confirmed' && (
          <>
            <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
              Email already confirmed
            </h1>
            <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Your email address has already been verified. You can continue to Proplyst.
            </p>
            <Button
              type="button"
              variant="primary"
              onClick={handleContinue}
              className="mt-6 w-full"
            >
              Continue to Proplyst
            </Button>
          </>
        )}

        {state === 'used_or_expired' && (
          <>
            <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
              Confirmation link expired
            </h1>
            <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              This link may have already been used or is no longer valid. If you already confirmed
              your account, you can sign in below — otherwise request a new confirmation email.
            </p>
            <a
              href="/login"
              className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-md bg-light-accent text-sm font-medium text-light-accentContrast hover:opacity-90 dark:bg-dark-accent dark:text-dark-accentContrast"
            >
              Sign in
            </a>

            {resendSubmitted ? (
              <p className="mt-4 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                If that address needs a new link, we just sent one.
              </p>
            ) : (
              <form onSubmit={handleResend} className="mt-4">
                <label className="block text-left text-xs text-light-textSecondary dark:text-dark-textSecondary">
                  Or request a new confirmation email
                </label>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
                />
                <Button type="submit" variant="secondary" className="mt-2 w-full">
                  Send new confirmation link
                </Button>
              </form>
            )}
          </>
        )}

        {state === 'invalid' && (
          <>
            <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
              Invalid confirmation link
            </h1>
            <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              This confirmation link isn't valid. Double-check the link from your email, or sign in
              if you've already confirmed your account.
            </p>
            <a
              href="/login"
              className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-md border border-light-border text-sm font-medium text-light-textPrimary hover:bg-light-surfaceRaised dark:border-dark-border dark:text-dark-textPrimary dark:hover:bg-dark-surfaceRaised"
            >
              Sign in
            </a>
          </>
        )}
      </div>
    </main>
  );
}
