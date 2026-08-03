'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { branding } from '@propvault/config';
import { getBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';

// Blocker #4, PWA_V1_COMPLETION_PLAN.md -- no password-reset flow existed anywhere. Real Supabase
// Auth call (resetPasswordForEmail), not a mock: Supabase always returns success regardless of
// whether the email is registered (its own anti-enumeration behavior), so this form's "sent" state
// is not itself a signal of whether an account exists -- matching API_SPEC.md §0's own
// org/account-enumeration rule applied here to auth.
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

    const supabase = getBrowserSupabaseClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (resetError) {
      setError('Something went wrong sending the reset email. Try again.');
      return;
    }
    setSent(true);
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
              If an account exists for <span className="font-medium">{email}</span>, a password reset
              link is on its way. Check your inbox.
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

            {error ? <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{error}</p> : null}

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
