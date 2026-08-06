'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { branding } from '@propvault/config';
import { Button } from '@/components/ui/Button';

// Blocker #4, PWA_V1_COMPLETION_PLAN.md -- no password-reset flow existed anywhere. Real password
// reset, not a mock -- Stage 7 (commercial-launch execution plan, TD-31) moved the actual
// Supabase Auth call server-side (POST /api/v1/auth/password-reset, rate-limited); that route
// always returns the same response regardless of whether the email is registered (Supabase's own
// anti-enumeration behavior), so this form's "sent" state is still not itself a signal of whether
// an account exists -- matching API_SPEC.md §0's own org/account-enumeration rule applied here to
// auth, unchanged by moving the call server-side.
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
      // No Supabase project to send a real email against in demo mode.
      setSent(true);
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch('/api/v1/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSubmitting(false);
      if (!response.ok) {
        setError(
          response.status === 429
            ? 'Too many attempts. Try again shortly.'
            : 'Something went wrong sending the reset email. Try again.',
        );
        return;
      }
      setSent(true);
    } catch {
      setSubmitting(false);
      setError('Something went wrong sending the reset email. Try again.');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
          <Building2 size={20} aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          {branding.productName} Admin
        </h1>

        {sent ? (
          <>
            <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              If an account exists for <span className="font-medium">{email}</span>, a password
              reset link is on its way. Check your inbox.
            </p>
            <Link href="/login" className="mt-6 block">
              <Button variant="secondary" className="w-full">
                Back to sign in
              </Button>
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Enter your email and we'll send you a link to reset your password.
            </p>

            <label className="mt-6 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
              Email
            </label>
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
            />

            {error ? (
              <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{error}</p>
            ) : null}

            <Button type="submit" variant="primary" disabled={submitting} className="mt-6 w-full">
              {submitting ? 'Sending…' : 'Send reset link'}
            </Button>
            <Link
              href="/login"
              className="mt-4 block text-center text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
