'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

// POST /api/v1/expenses/:id/record -- thin wrapper over record_expense(), which enforces
// accountant+ internally regardless of whether this button is shown at all.
//
// V1 launch-completion pass: `hasEvidence` (whether the expense already has a linked document)
// controls whether the exception-reason field is shown at all -- the route itself is the real
// enforcement (a request with no evidence and no reason is rejected 400 regardless of what this
// button sends), this is just so the staff member isn't surprised by a rejection they can't
// explain from the UI.
export function RecordExpenseButton({
  expenseId,
  hasEvidence,
}: {
  expenseId: string;
  hasEvidence: boolean;
}) {
  const router = useRouter();
  const [paidImmediately, setPaidImmediately] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/expenses/${expenseId}/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paidImmediately,
          ...(hasEvidence ? {} : { exceptionReason: exceptionReason || undefined }),
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to record expense.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to record expense — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-light-border p-4 dark:border-dark-border">
      {error ? (
        <p className="mb-2 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
          {error}
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
        <input
          type="checkbox"
          checked={paidImmediately}
          onChange={(e) => setPaidImmediately(e.target.checked)}
        />
        Paid immediately (posts Cr Bank instead of Cr Accounts Payable)
      </label>
      {!hasEvidence ? (
        <label className="mt-3 block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">
            No evidence is attached — explain why this is being posted anyway
          </span>
          <textarea
            value={exceptionReason}
            onChange={(e) => setExceptionReason(e.target.value)}
            rows={2}
            maxLength={1000}
            className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
            placeholder="e.g. Verbal quote confirmed, invoice to follow from vendor"
          />
        </label>
      ) : null}
      <Button className="mt-3" variant="primary" size="sm" disabled={busy} onClick={record}>
        {busy ? 'Recording…' : 'Record expense'}
      </Button>
    </div>
  );
}
