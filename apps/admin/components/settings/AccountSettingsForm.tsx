'use client';

import { useState, type FormEvent } from 'react';
import { getBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

// Shared by /settings (org staff, PWA_V1_COMPLETION_PLAN.md #7) and /profile (tenant portal,
// #11) -- an authenticated identity's own name/email/password are not role-scoped, every user
// gets exactly one `profiles` row (migration 20260101000004) regardless of which of the three
// independent identity systems (org staff/owner/tenant) they also belong to. Email and password
// go straight through Supabase Auth client-side (supabase.auth.updateUser), same real call
// ResetPasswordForm.tsx already uses -- no app-level email/password column exists to PATCH
// instead. Each of the three fields saves independently (its own button), not one combined form
// submit, since they're three unrelated operations with different failure modes (display name is
// a plain DB write; email change sends a confirmation link; password takes effect immediately).
export function AccountSettingsForm({
  initialDisplayName,
  initialEmail,
}: {
  initialDisplayName: string;
  initialEmail: string;
}) {
  return (
    <div className="space-y-6">
      <DisplayNameSection initialDisplayName={initialDisplayName} />
      <EmailSection initialEmail={initialEmail} />
      <PasswordSection />
    </div>
  );
}

function DisplayNameSection({ initialDisplayName }: { initialDisplayName: string }) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch('/api/v1/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to save your name.');
        return;
      }
      setSaved(true);
    } catch {
      setError('Failed to save — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel className="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">Display name</h2>
        {error ? <p className="text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
        {saved ? <p className="text-xs text-light-statusPaid dark:text-dark-statusPaid">Saved.</p> : null}
        <input
          required
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            setSaved(false);
          }}
          className={inputClass}
        />
        <Button type="submit" disabled={submitting || displayName === initialDisplayName}>
          {submitting ? 'Saving…' : 'Save name'}
        </Button>
      </form>
    </Panel>
  );
}

function EmailSection({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setDone(false);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error: updateError } = await supabase.auth.updateUser({ email });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setDone(true);
    } catch {
      setError('Failed to update email — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel className="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">Email address</h2>
        {error ? <p className="text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
        {done ? (
          <p className="text-xs text-light-statusPaid dark:text-dark-statusPaid">
            Confirmation links sent to both your old and new address — the change takes effect once you confirm.
          </p>
        ) : null}
        <input
          required
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setDone(false);
          }}
          className={inputClass}
        />
        <Button type="submit" disabled={submitting || email === initialEmail}>
          {submitting ? 'Saving…' : 'Change email'}
        </Button>
      </form>
    </Panel>
  );
}

function PasswordSection() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (password.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setDone(true);
      setPassword('');
      setConfirmPassword('');
    } catch {
      setError('Failed to update password — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel className="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">Password</h2>
        {error ? <p className="text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
        {done ? <p className="text-xs text-light-statusPaid dark:text-dark-statusPaid">Password updated.</p> : null}
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        <Button type="submit" disabled={submitting || !password}>
          {submitting ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </Panel>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
