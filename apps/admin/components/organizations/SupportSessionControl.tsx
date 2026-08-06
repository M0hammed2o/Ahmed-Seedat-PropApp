'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

// PWA_V1_COMPLETION_PLAN.md #12, SUPER_ADMIN.md §6. Reason is required (Zod min length 10,
// mirroring the DB check constraint) -- entering support mode is itself the audited event
// (support_access_sessions.reason not null, insert-only), so this form can't be skipped past.
// "Enter" navigates straight into /dashboard, which now resolves the just-opened session via
// resolvePortalSession()'s support-session branch (migration 20260101000057) and renders the
// target org read-only with the persistent SupportModeBanner.
export function SupportSessionControl({ orgId, canStart }: { orgId: string; canStart: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canStart) {
    return (
      <p className="mt-4 text-xs text-light-textMuted dark:text-dark-textMuted">
        Support-session entry requires support_admin or above.
      </p>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/support-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, reason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to start support session.');
        return;
      }
      router.push('/dashboard');
    } catch {
      setError('Failed to start support session — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-4">
        <Button size="sm" onClick={() => setOpen(true)}>
          Start support session
        </Button>
        <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
          Read-only access to this org's data, banner-visible for the duration. Write actions
          require a separate, not-yet-built escalation step (SUPER_ADMIN.md §6) — none are available
          in support mode today.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 max-w-md space-y-2">
      {error ? <p className="text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
      <label className="block text-xs">
        <span className="text-light-textMuted dark:text-dark-textMuted">
          Reason (required, at least 10 characters)
        </span>
        <textarea
          required
          minLength={10}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
        />
      </label>
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={submitting || reason.length < 10}
        >
          {submitting ? 'Starting…' : 'Enter support mode'}
        </Button>
        <Button type="button" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
