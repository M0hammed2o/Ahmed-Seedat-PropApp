'use client';

import { useState } from 'react';
import { getBrowserSupabaseClient } from '@/lib/supabase/client';

// PRODUCT DECISION 1 (2026-08-03): V1 auth methods are email/password, Google, and Apple --
// deliberately not "as many providers as possible" (the instruction is explicit: "do not add
// numerous low-value social providers"). Shared by /login and /register since both need to offer
// the same two OAuth entry points, with the browser doing a real redirect-based OAuth flow
// (supabase.auth.signInWithOAuth) -- there is no separate signup vs signin call for OAuth
// providers, Supabase creates the account on first sign-in automatically.
//
// `next` carries wherever the caller should land after /auth/callback finishes -- critically
// this is how "invitation continuation after authentication" works for a user who clicked
// Google/Apple from an org- or tenant-invitation page: they come back to that exact invitation,
// not a generic dashboard.
export function OAuthButtons({ next = '/' }: { next?: string }) {
  const [pending, setPending] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startOAuth(provider: 'google' | 'apple') {
    setError(null);
    setPending(provider);
    const supabase = getBrowserSupabaseClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    // signInWithOAuth only returns an error before the redirect happens (e.g. the provider isn't
    // configured at all) -- a real provider-side failure (user cancels, consent denied) comes
    // back later as ?error=... on /auth/callback, handled there, not here.
    if (oauthError) {
      setError(`${provider === 'google' ? 'Google' : 'Apple'} sign-in is not available right now.`);
      setPending(null);
    }
  }

  return (
    <div className="mt-4 space-y-2">
      {error ? <p className="text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
      <button
        type="button"
        onClick={() => startOAuth('google')}
        disabled={pending !== null}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm font-medium text-light-textPrimary transition-colors hover:bg-light-surface disabled:opacity-60 dark:border-dark-border dark:text-dark-textPrimary dark:hover:bg-dark-surface"
      >
        <GoogleIcon />
        {pending === 'google' ? 'Redirecting…' : 'Continue with Google'}
      </button>
      <button
        type="button"
        onClick={() => startOAuth('apple')}
        disabled={pending !== null}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm font-medium text-light-textPrimary transition-colors hover:bg-light-surface disabled:opacity-60 dark:border-dark-border dark:text-dark-textPrimary dark:hover:bg-dark-surface"
      >
        <AppleIcon />
        {pending === 'apple' ? 'Redirecting…' : 'Continue with Apple'}
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.6H24v9h11.8c-.5 2.7-2 5-4.3 6.5v5.4h7C42.5 37 45.1 31.3 45.1 24.5z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.3l-7-5.4c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.6C7.9 41 15.3 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.6 28.3c-.4-1.3-.7-2.7-.7-4.3s.2-2.9.7-4.3v-5.6H4.3C2.8 17.1 2 20.5 2 24s.8 6.9 2.3 9.9l7.3-5.6z"
      />
      <path
        fill="#EA4335"
        d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.2-6.2C34.9 4.2 29.9 2 24 2 15.3 2 7.9 7 4.3 14.1l7.3 5.6c1.7-5.2 6.6-9 12.4-9z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.365 1.43c0 1.14-.42 2.07-1.26 2.79-.86.75-1.83 1.18-2.9 1.09-.13-1.1.4-2.24 1.24-3 .86-.79 2.16-1.29 2.92-1.28.02.13.02.27 0 .4zm4.02 15.99c-.4.92-.88 1.79-1.44 2.6-.77 1.1-1.4 1.86-1.88 2.28-.75.71-1.55 1.07-2.41 1.09-.62 0-1.36-.18-2.22-.54-.87-.36-1.66-.54-2.4-.54-.77 0-1.6.18-2.48.54-.88.36-1.59.55-2.13.57-.83.03-1.65-.34-2.46-1.11-.52-.46-1.18-1.24-1.98-2.35-.86-1.19-1.57-2.57-2.13-4.13-.6-1.68-.9-3.31-.9-4.89 0-1.81.39-3.37 1.17-4.68.61-1.05 1.42-1.88 2.44-2.49a6.5 6.5 0 0 1 3.3-.99c.66 0 1.53.2 2.6.6 1.07.4 1.76.6 2.06.6.22 0 .98-.24 2.28-.71 1.23-.44 2.27-.62 3.12-.55 2.31.19 4.04 1.1 5.2 2.74-2.07 1.25-3.1 3-3.08 5.26.02 1.76.65 3.22 1.9 4.38.57.53 1.2.94 1.9 1.23-.15.44-.31.87-.5 1.29z" />
    </svg>
  );
}
