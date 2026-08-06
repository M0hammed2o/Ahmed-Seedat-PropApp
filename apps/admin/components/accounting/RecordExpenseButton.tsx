'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

// POST /api/v1/expenses/:id/record -- thin wrapper over record_expense(), which enforces
// accountant+ internally regardless of whether this button is shown at all.
export function RecordExpenseButton({ expenseId }: { expenseId: string }) {
  const router = useRouter();
  const [paidImmediately, setPaidImmediately] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/expenses/${expenseId}/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paidImmediately }),
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
      <Button className="mt-3" variant="primary" size="sm" disabled={busy} onClick={record}>
        {busy ? 'Recording…' : 'Record expense'}
      </Button>
    </div>
  );
}
