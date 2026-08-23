'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { ProplystLogo } from '@/components/branding/ProplystLogo';

/**
 * Provisioned-staff account model (this date): the unauthenticated half of /staff/activate. Turns
 * a GoTrue `token_hash` into a session and a chosen password in one submit, via
 * POST /api/v1/staff/activate. On success, `router.replace('/staff/activate'); router.refresh();`
 * re-enters the SERVER page with a now-authenticated session, which then runs the same legal-
 * consent/profile-completion gates every other continuation flow uses (safeNextPathOr pattern) --
 * no client-side knowledge of what comes after this step is needed here.
 */
export function SetPasswordClient({ tokenHash }: { tokenHash: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the first submission (with tokenHash) succeeds partway -- see the API route's own
  // comment -- a retry must never resend the now-consumed token; this flips permanently.
  const [tokenConsumed, setTokenConsumed] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/v1/staff/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenHash: tokenConsumed ? undefined : tokenHash,
          password,
          confirmPassword,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setTokenConsumed(true);
        setError(body.error?.message ?? 'Could not set your password. Please try again.');
        setSubmitting(false);
        return;
      }
      router.replace('/staff/activate');
      router.refresh();
    } catch {
      setTokenConsumed(true);
      setError('Failed to set your password — check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
        <div className="mx-auto flex justify-center">
          <ProplystLogo />
        </div>
        <span className="mx-auto mt-4 flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
          <Building2 size={20} aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-center font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          You've been added to a team
        </h1>
        <p className="mt-1 text-center text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Set your password to activate your account.
        </p>

        <form onSubmit={handleSubmit} className="mt-6">
          <label className="block text-xs text-light-textSecondary dark:text-dark-textSecondary">
            Password
          </label>
          <PasswordInput
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
          />

          <label className="mt-4 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
            Confirm password
          </label>
          <PasswordInput
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
          />

          {error ? (
            <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{error}</p>
          ) : null}

          <Button type="submit" variant="primary" disabled={submitting} className="mt-6 w-full">
            {submitting ? 'Setting password…' : 'Continue'}
          </Button>
        </form>
      </div>
    </main>
  );
}
