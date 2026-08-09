'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProplystLogo } from '@/components/branding/ProplystLogo';
import { Button } from '@/components/ui/Button';

export function LegalConsentClient({ next }: { next: string }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accepted) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/v1/legal-consent', { method: 'POST' });
      if (!response.ok) {
        setError('Could not save your acceptance. Try again.');
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Could not save your acceptance — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised"
      >
        <ProplystLogo />
        <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          Before you continue
        </h1>
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Please review and accept our Terms and Privacy Policy to keep using your account.
        </p>

        <label className="mt-6 flex items-start gap-3 text-sm text-light-textPrimary dark:text-dark-textPrimary">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-light-border text-light-accent focus:ring-light-accent/40 dark:border-dark-border dark:text-dark-accent"
          />
          <span>
            I agree to the{' '}
            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-light-accent underline dark:text-dark-accent"
            >
              Terms &amp; Conditions
            </a>{' '}
            and{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-light-accent underline dark:text-dark-accent"
            >
              Privacy Policy
            </a>
            .
          </span>
        </label>

        {error ? (
          <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{error}</p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          disabled={submitting || !accepted}
          className="mt-6 w-full"
        >
          {submitting ? 'Saving…' : 'Agree and continue'}
        </Button>
      </form>
    </main>
  );
}
