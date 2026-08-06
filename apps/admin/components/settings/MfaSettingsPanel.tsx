'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

interface Factor {
  id: string;
  friendlyName: string | null;
  status: string;
  createdAt: string;
}

/**
 * Two-factor authentication (TOTP) enrollment/removal (Stage 7, commercial-launch execution
 * plan). Every real call goes through apps/admin/app/api/v1/auth/mfa/* -- this panel itself never
 * talks to Supabase Auth directly, matching the same server-hook-point reasoning the sign-in flow
 * itself was rebuilt around (TECHNICAL_DEBT_REGISTER.md TD-31): rate limiting and the actual
 * session-cookie-writing side effect of a successful `challengeAndVerify()` both need to happen
 * server-side.
 */
export function MfaSettingsPanel() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState('');

  async function loadFactors() {
    try {
      const response = await fetch('/api/v1/auth/mfa/factors');
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not load two-factor authentication status.');
        return;
      }
      setFactors(body.factors.filter((f: Factor) => f.status === 'verified'));
    } catch {
      setError('Could not load two-factor authentication status.');
    }
  }

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
      setFactors([]);
      return;
    }
    loadFactors();
  }, []);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/v1/auth/mfa/enroll', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(
          response.status === 429
            ? 'Too many attempts. Try again shortly.'
            : (body.error?.message ?? 'Could not start enrollment.'),
        );
        return;
      }
      setEnrollment({ factorId: body.factorId, qrCode: body.qrCode, secret: body.secret });
      setEnrolling(true);
    } catch {
      setError('Could not start enrollment — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollment) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/v1/auth/mfa/enroll', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factorId: enrollment.factorId, code }),
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
      setEnrolling(false);
      setEnrollment(null);
      setCode('');
      await loadFactors();
    } catch {
      setError('Could not verify your code — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function removeFactor(factorId: string) {
    if (
      !window.confirm(
        'Remove two-factor authentication? You will only need your password to sign in.',
      )
    )
      return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/v1/auth/mfa/unenroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factorId }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Could not remove this factor.');
        return;
      }
      await loadFactors();
    } catch {
      setError('Could not remove this factor — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (factors === null) return null;

  return (
    <Panel className="max-w-xl">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Two-factor authentication
      </h2>
      <p className="mt-1 text-xs text-light-textSecondary dark:text-dark-textSecondary">
        Require a code from an authenticator app in addition to your password when signing in.
      </p>
      {error ? (
        <p className="mt-2 text-xs text-light-danger dark:text-dark-danger">{error}</p>
      ) : null}

      {enrolling && enrollment ? (
        <form onSubmit={confirmEnroll} className="mt-4 space-y-3">
          <p className="text-xs text-light-textSecondary dark:text-dark-textSecondary">
            Scan this QR code with your authenticator app, then enter the 6-digit code it generates.
          </p>
          {/* Plain <img>, not next/image: a data: URI from Supabase's own MFA enroll response, not an optimizable remote image. */}
          <img
            src={enrollment.qrCode}
            alt="Authenticator app QR code"
            className="h-40 w-40 rounded-md border border-light-border dark:border-dark-border"
          />
          <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
            Can't scan? Enter this code manually:{' '}
            <code className="font-mono">{enrollment.secret}</code>
          </p>
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-center text-lg tracking-[0.5em] text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : 'Confirm'}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEnrolling(false);
                setEnrollment(null);
                setCode('');
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : factors.length > 0 ? (
        <div className="mt-4 space-y-2">
          {factors.map((factor) => (
            <div
              key={factor.id}
              className="flex items-center justify-between rounded-lg border border-light-border px-3 py-2 dark:border-dark-border"
            >
              <span className="text-sm text-light-textPrimary dark:text-dark-textPrimary">
                {factor.friendlyName ?? 'Authenticator app'} — enabled
              </span>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => removeFactor(factor.id)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <Button size="sm" className="mt-4" disabled={busy} onClick={startEnroll}>
          {busy ? 'Starting…' : 'Add authenticator app'}
        </Button>
      )}
    </Panel>
  );
}
