'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { branding } from '@propvault/config';
import { getBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';

type SessionState = 'checking' | 'valid' | 'invalid';

// Blocker #4, PWA_V1_COMPLETION_PLAN.md. Real bug found and fixed 2026-08-03 verifying this
// against local Supabase, not assumed: Supabase's recovery email link now uses the PKCE flow by
// default (`type=recovery`, redirects here with `?code=...` in the query string, not
// `#access_token=...` in the URL fragment). @supabase/ssr's browser client does NOT
// auto-exchange a PKCE `?code=` the way `detectSessionInUrl` auto-detects a hash-fragment
// token -- confirmed live: without the explicit exchange below, this page always fell through to
// "invalid or expired" even immediately after clicking a freshly-delivered real reset email.
// exchangeCodeForSession() is the documented fix (supabase.com/docs/guides/auth/server-side/
// nextjs) for a query-string `?code=`; the onAuthStateChange listener is kept as a fallback for
// any legacy hash-fragment link.
export function ResetPasswordForm() {
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
      setSessionState('valid');
      return;
    }

    const supabase = getBrowserSupabaseClient();
    let settled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        settled = true;
        setSessionState('valid');
      }
    });

    const code = new URLSearchParams(window.location.search).get('code');
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data }) => {
        if (!settled && data.session) {
          settled = true;
          setSessionState('valid');
        }
      });
    }

    // Fallback: some browsers fire the event before this listener attaches -- check for an
    // already-established session directly after a short delay.
    const timer = setTimeout(async () => {
      if (settled) return;
      const { data } = await supabase.auth.getSession();
      setSessionState(data.session ? 'valid' : 'invalid');
    }, 1500);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);

    if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
      setSubmitting(false);
      setDone(true);
      return;
    }

    const supabase = getBrowserSupabaseClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError('Could not update your password. Try requesting a new reset link.');
      return;
    }
    setDone(true);
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

        {sessionState === 'checking' ? (
          <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            Verifying your reset link…
          </p>
        ) : null}

        {sessionState === 'invalid' ? (
          <>
            <p className="mt-1 text-sm text-light-danger dark:text-dark-danger">
              This reset link is invalid or has expired.
            </p>
            <Link href="/forgot-password" className="mt-6 block">
              <Button variant="primary" className="w-full">
                Request a new link
              </Button>
            </Link>
          </>
        ) : null}

        {sessionState === 'valid' && !done ? (
          <form onSubmit={handleSubmit}>
            <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Choose a new password.
            </p>

            <label className="mt-6 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
              New password
            </label>
            <input
              required
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
            />

            <label className="mt-4 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
              Confirm new password
            </label>
            <input
              required
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
            />

            {error ? (
              <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{error}</p>
            ) : null}

            <Button type="submit" variant="primary" disabled={submitting} className="mt-6 w-full">
              {submitting ? 'Saving…' : 'Save new password'}
            </Button>
          </form>
        ) : null}

        {done ? (
          <>
            <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Your password has been updated.
            </p>
            <Button
              variant="primary"
              className="mt-6 w-full"
              onClick={() => {
                router.replace('/login');
              }}
            >
              Sign in
            </Button>
          </>
        ) : null}
      </div>
    </main>
  );
}
