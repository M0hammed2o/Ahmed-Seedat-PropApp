'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Building2, CheckCircle2, XCircle } from 'lucide-react';
import { branding } from '@propvault/config';
import { getBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';

type Stage = 'checking-session' | 'signed-out' | 'confirming' | 'code-entry' | 'success' | 'error';

interface InvitationContext {
  valid: boolean;
  orgName?: string | null;
  expiresAt?: string | null;
  propertyLabel?: string | null;
  unitLabel?: string | null;
}

/**
 * TENANT UI (PRODUCT DECISION 2, 2026-08-03; context preview added in the tenant onboarding
 * completion pass, WORKLOG.md this date). Still never renders any payment/financial/ID/document
 * data -- this page's job is turning a token or (code + email) into a linked account via
 * POST /api/v1/tenant-invitations/accept, then handing off to the real portal (/portal) which
 * loads everything else through its own normal RLS-scoped read.
 *
 * A safe, minimal preview (org name always; property/unit only once signed in) is fetched via
 * GET /api/v1/tenant-invitations/context -- the audit's "INVITATION UX" gap: a recipient
 * previously had no way to tell what they were accepting before clicking through. This is
 * decorative only (best-effort, never blocks the accept flow if it fails) -- the real
 * authorization boundary remains accept_tenant_invitation() alone.
 *
 * Also reachable with no token at all (manual short-code entry, e.g. a landlord read a code
 * aloud) -- both cases live on the same route so the "already-linked"/"expired"/"invalid" states
 * share one place to be designed once, matching PRODUCT DECISION 2's explicit UI state list.
 */
export function ActivateClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [stage, setStage] = useState<Stage>('checking-session');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [context, setContext] = useState<InvitationContext | null>(null);

  const currentPath = token ? `/activate?token=${encodeURIComponent(token)}` : '/activate';

  useEffect(() => {
    if (!token || process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return;
    // Best-effort preview -- never blocks or errors the real flow below if this fails.
    fetch(`/api/v1/tenant-invitations/context?token=${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body) setContext(body as InvitationContext);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once on mount
  }, []);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
      setStage('signed-out');
      return;
    }
    const supabase = getBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        setStage('signed-out');
        return;
      }
      if (token) {
        void accept({ token });
      } else {
        setStage('code-entry');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once on mount
  }, []);

  async function accept(body: { token: string } | { shortCode: string; email: string }) {
    setStage('confirming');
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/v1/tenant-invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseBody = await response.json();
      if (!response.ok) {
        setErrorMessage(responseBody.error?.message ?? 'This invitation could not be activated.');
        setStage('error');
        return;
      }
      setStage('success');
    } catch {
      setErrorMessage('Failed to activate — check your connection and try again.');
      setStage('error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    void accept({ shortCode: code, email });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 text-center shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
          <Building2 size={20} aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          {branding.productName}
        </h1>

        {context?.valid ? (
          <div className="mt-4 rounded-lg border border-light-border bg-light-surface px-4 py-3 text-left text-xs dark:border-dark-border dark:bg-dark-surface">
            <p className="font-medium text-light-textPrimary dark:text-dark-textPrimary">
              You&apos;ve been invited to {branding.productName}
            </p>
            {context.orgName ? (
              <p className="mt-1 text-light-textSecondary dark:text-dark-textSecondary">
                Managed by: {context.orgName}
              </p>
            ) : null}
            {context.propertyLabel ? (
              <p className="mt-1 text-light-textSecondary dark:text-dark-textSecondary">
                Property: {context.propertyLabel}
              </p>
            ) : null}
            {context.unitLabel ? (
              <p className="mt-1 text-light-textSecondary dark:text-dark-textSecondary">
                Unit: {context.unitLabel}
              </p>
            ) : null}
          </div>
        ) : null}

        {stage === 'checking-session' || stage === 'confirming' ? (
          <p className="mt-3 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            Activating your account…
          </p>
        ) : null}

        {stage === 'signed-out' ? (
          <>
            <p className="mt-3 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Sign in or create an account to activate your tenant portal access.
            </p>
            <div className="mt-6 space-y-2">
              <Link href={`/login?next=${encodeURIComponent(currentPath)}`}>
                <Button variant="primary" className="w-full">
                  Sign in
                </Button>
              </Link>
              <Link href={`/register?next=${encodeURIComponent(currentPath)}`}>
                <Button className="w-full">Create an account</Button>
              </Link>
            </div>
          </>
        ) : null}

        {stage === 'code-entry' ? (
          <form onSubmit={handleCodeSubmit} className="mt-4 text-left">
            <p className="mb-3 text-center text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Enter the activation code your landlord gave you.
            </p>
            <label className="block text-xs text-light-textSecondary dark:text-dark-textSecondary">
              Activation code
              <input
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm font-mono uppercase text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary"
              />
            </label>
            <label className="mt-3 block text-xs text-light-textSecondary dark:text-dark-textSecondary">
              Email address on file with your landlord
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary"
              />
            </label>
            <Button type="submit" variant="primary" disabled={submitting} className="mt-4 w-full">
              {submitting ? 'Activating…' : 'Activate'}
            </Button>
          </form>
        ) : null}

        {stage === 'success' ? (
          <>
            <CheckCircle2
              size={32}
              className="mx-auto mt-4 text-light-statusPaid dark:text-dark-statusPaid"
              aria-hidden="true"
            />
            <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Your account is now linked. You can see your lease, payments, documents, and more.
            </p>
            <Button
              variant="primary"
              className="mt-4 w-full"
              onClick={() => router.replace('/portal')}
            >
              Go to my portal
            </Button>
          </>
        ) : null}

        {stage === 'error' ? (
          <>
            <XCircle
              size={32}
              className="mx-auto mt-4 text-light-danger dark:text-dark-danger"
              aria-hidden="true"
            />
            <p className="mt-2 text-sm text-light-danger dark:text-dark-danger">{errorMessage}</p>
            <p className="mt-3 text-xs text-light-textMuted dark:text-dark-textMuted">
              If this keeps happening, contact your landlord or property manager for help.
            </p>
            <Button className="mt-4 w-full" onClick={() => setStage('code-entry')}>
              Try a different code
            </Button>
          </>
        ) : null}
      </div>
    </main>
  );
}
