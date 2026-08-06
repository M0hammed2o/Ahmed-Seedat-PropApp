'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { registerSchema } from '@propvault/validation';
import { branding, TERMS_VERSION, PRIVACY_VERSION } from '@propvault/config';
import { Button } from '@/components/ui/Button';
import { OAuthButtons } from '@/components/auth/OAuthButtons';

/**
 * PRODUCT DECISION 1 (2026-08-03). `next` (from ?next=) carries invitation continuation --
 * "Invited owner or staff member" / "Tenant" entry paths both read "creates an account or signs
 * in" as their first step, then continue to the invitation itself. A landlord/staff member who
 * opens an org-invite or tenant-activation link while signed out is sent here (or /login) with
 * ?next=<that exact invite URL>, and lands back on it the moment their session exists -- whether
 * that's immediately (email confirmations off) or after clicking the verification email
 * (?next is threaded through emailRedirectTo -> /auth/callback -> here).
 *
 * Plain controlled state, not react-hook-form -- matches every other form built this session
 * (AccountSettingsForm, OrganizationSettingsForm, LeaseTemplatesSettings, ...); LoginForm.tsx
 * predates that convention and still uses react-hook-form, left as-is rather than churned for
 * consistency's own sake.
 */
export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/onboarding/create-organization';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [verificationPending, setVerificationPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setFieldErrors({});

    const parsed = registerSchema.safeParse({
      email,
      password,
      confirmPassword,
      acceptedTermsVersion: acceptedTerms ? TERMS_VERSION : '',
      acceptedPrivacyVersion: acceptedPrivacy ? PRIVACY_VERSION : '',
    });
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors);
      return;
    }

    setSubmitting(true);
    try {
      if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
        router.replace('/overview');
        router.refresh();
        return;
      }

      // Stage 7 (commercial-launch execution plan, TD-31): sign-up now goes through a real
      // server route (POST /api/v1/auth/signup, rate-limited) instead of calling Supabase Auth
      // directly from the browser -- the only way rate limiting could ever have a hook point.
      const response = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...parsed.data, next }),
      });
      const body = await response.json();

      if (!response.ok) {
        setSubmitError(response.status === 429 ? 'Too many attempts. Try again shortly.' : (body.error?.message ?? 'Could not create your account. Check your details and try again.'));
        return;
      }

      // hasSession is true only when email confirmations are disabled for this project;
      // otherwise the caller must click the confirmation link (this project has confirmations ON,
      // supabase/config.toml [auth.email]) -- the route establishes the session cookie itself in
      // the hasSession case, so a client-side redirect is all that's needed here.
      if (body.hasSession) {
        router.replace(next);
        router.refresh();
        return;
      }

      setVerificationPending(true);
    } catch {
      setSubmitError('Could not create your account — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (verificationPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
        <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 text-center shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
            <Building2 size={20} aria-hidden="true" />
          </span>
          <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
            Check your email
          </h1>
          <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            We sent a verification link to confirm your account. Click it to continue.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
          <Building2 size={20} aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          Create your {branding.productName} account
        </h1>
        <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Manage properties, or link an invitation from your landlord.
        </p>

        <OAuthButtons next={next} />

        <div className="my-4 flex items-center gap-3 text-xs text-light-textMuted dark:text-dark-textMuted">
          <span className="h-px flex-1 bg-light-border dark:bg-dark-border" />
          or
          <span className="h-px flex-1 bg-light-border dark:bg-dark-border" />
        </div>

        <label className="block text-xs text-light-textSecondary dark:text-dark-textSecondary">Email</label>
        <input
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        {fieldErrors.email?.length ? <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{fieldErrors.email[0]}</p> : null}

        <label className="mt-4 block text-xs text-light-textSecondary dark:text-dark-textSecondary">Password</label>
        <input
          required
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        {fieldErrors.password?.length ? <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{fieldErrors.password[0]}</p> : null}

        <label className="mt-4 block text-xs text-light-textSecondary dark:text-dark-textSecondary">Confirm password</label>
        <input
          required
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputClass}
        />
        {fieldErrors.confirmPassword?.length ? (
          <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{fieldErrors.confirmPassword[0]}</p>
        ) : null}

        <label className="mt-4 flex items-start gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
          <input type="checkbox" className="mt-0.5" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
          <span>
            I agree to the{' '}
            <Link href="/terms" target="_blank" className="text-light-accent hover:underline dark:text-dark-accent">
              Terms of Service
            </Link>
          </span>
        </label>
        {fieldErrors.acceptedTermsVersion?.length ? (
          <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{fieldErrors.acceptedTermsVersion[0]}</p>
        ) : null}

        <label className="mt-2 flex items-start gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
          <input type="checkbox" className="mt-0.5" checked={acceptedPrivacy} onChange={(e) => setAcceptedPrivacy(e.target.checked)} />
          <span>
            I agree to the{' '}
            <Link href="/privacy" target="_blank" className="text-light-accent hover:underline dark:text-dark-accent">
              Privacy Policy
            </Link>
          </span>
        </label>
        {fieldErrors.acceptedPrivacyVersion?.length ? (
          <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{fieldErrors.acceptedPrivacyVersion[0]}</p>
        ) : null}

        {submitError ? <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{submitError}</p> : null}

        <Button type="submit" variant="primary" disabled={submitting} className="mt-6 w-full">
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>

        <p className="mt-4 text-center text-xs text-light-textSecondary dark:text-dark-textSecondary">
          Already have an account?{' '}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-light-accent hover:underline dark:text-dark-accent">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}

const inputClass =
  'mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10';
