'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProplystLogo } from '@/components/branding/ProplystLogo';
import { Button } from '@/components/ui/Button';

interface FieldErrors {
  firstName?: string[];
  lastName?: string[];
  phone?: string[];
}

export function CompleteAccountClient({ next }: { next: string }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const response = await fetch('/api/v1/profile/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, phone }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 400 && body?.error?.field_errors) {
          setFieldErrors(body.error.field_errors);
        } else if (response.status === 429) {
          setError('Too many attempts. Try again shortly.');
        } else {
          setError(body?.error?.message ?? 'Could not save your details. Try again.');
        }
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Could not save your details — check your connection and try again.');
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
          Complete your account
        </h1>
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          A few details before you get started.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="complete-account-first-name"
              className="block text-xs text-light-textSecondary dark:text-dark-textSecondary"
            >
              First name
            </label>
            <input
              id="complete-account-first-name"
              required
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
            />
            {fieldErrors.firstName ? (
              <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">
                {fieldErrors.firstName[0]}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="complete-account-last-name"
              className="block text-xs text-light-textSecondary dark:text-dark-textSecondary"
            >
              Last name
            </label>
            <input
              id="complete-account-last-name"
              required
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
            />
            {fieldErrors.lastName ? (
              <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">
                {fieldErrors.lastName[0]}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="complete-account-phone"
              className="block text-xs text-light-textSecondary dark:text-dark-textSecondary"
            >
              Phone number
            </label>
            <input
              id="complete-account-phone"
              required
              type="tel"
              autoComplete="tel"
              placeholder="082 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
            />
            {fieldErrors.phone ? (
              <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">
                {fieldErrors.phone[0]}
              </p>
            ) : (
              <p className="mt-1 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                South African numbers work as-is (082…); international numbers, include a +.
              </p>
            )}
          </div>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{error}</p>
        ) : null}

        <Button type="submit" variant="primary" disabled={submitting} className="mt-6 w-full">
          {submitting ? 'Saving…' : 'Continue'}
        </Button>
      </form>
    </main>
  );
}
