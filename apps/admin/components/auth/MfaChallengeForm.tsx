'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ProplystLogo } from '@/components/branding/ProplystLogo';

/**
 * Shared TOTP challenge UI -- the second-factor entry step, used both inline (LoginForm.tsx,
 * immediately after a password-only signin returns `mfaRequired: true`) and standalone
 * (app/mfa-challenge/page.tsx, Stage 3 customer MFA bypass fix, WORKLOG.md this date -- when a
 * user navigated away mid-challenge and needs to complete it later without re-entering their
 * password). One component, one copy of the verify-code logic -- extracted from LoginForm.tsx's
 * own previously-inline version rather than duplicated across both call sites.
 */
export function MfaChallengeForm({
  factorId,
  onVerified,
}: {
  factorId: string;
  onVerified: () => void;
}) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/v1/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factorId, code }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(
          response.status === 429
            ? 'Too many attempts. Try again shortly.'
            : (body.error?.message ?? 'Incorrect code.'),
        );
        return;
      }
      onVerified();
    } catch {
      setError('Could not verify your code — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised"
    >
      <ProplystLogo />
      <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
        Enter your authentication code
      </h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Open your authenticator app and enter the 6-digit code.
      </p>

      <label className="mt-6 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
        Code
      </label>
      <input
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-center text-lg tracking-[0.5em] text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
      />

      {error ? (
        <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{error}</p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        disabled={submitting || code.length !== 6}
        className="mt-6 w-full"
      >
        {submitting ? 'Verifying…' : 'Verify'}
      </Button>
    </form>
  );
}
