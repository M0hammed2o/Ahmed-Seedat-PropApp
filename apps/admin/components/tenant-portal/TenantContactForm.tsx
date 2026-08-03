'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

// PWA_V1_COMPLETION_PLAN.md #11. Contact info only (email/phone) -- full name is staff-managed
// (shown read-only), matching PATCH /api/v1/tenant-portal/profile's column whitelist.
export function TenantContactForm({
  fullName,
  initialEmail,
  initialPhone,
}: {
  fullName: string;
  initialEmail: string;
  initialPhone: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch('/api/v1/tenant-portal/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || null, phone: phone || null }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to save contact info.');
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
        <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">Contact info</h2>
        {error ? <p className="text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
        {saved ? <p className="text-xs text-light-statusPaid dark:text-dark-statusPaid">Saved.</p> : null}

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Full name (contact your landlord to change)</span>
          <input disabled value={fullName} className={`${inputClass} opacity-60`} />
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Contact email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSaved(false);
            }}
            className={inputClass}
          />
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Contact phone</span>
          <input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setSaved(false);
            }}
            className={inputClass}
          />
        </label>

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save contact info'}
        </Button>
      </form>
    </Panel>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
