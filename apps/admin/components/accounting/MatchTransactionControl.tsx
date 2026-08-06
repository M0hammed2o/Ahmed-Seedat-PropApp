'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RentSchedule } from '@propvault/types';
import { Button } from '@/components/ui/Button';

// V1 bank matching (TECHNICAL_DEBT_REGISTER.md TD-22): confirm-only, the caller picks which
// pending/overdue rent_schedule a transaction matches -- there is no automated propose step
// (calculateMatchScore) wired into this endpoint yet, a documented, deliberate V1 gap. A plain
// picker is honestly simpler for V1 than fabricating a scored-suggestion UI around a feature that
// isn't built.
export function MatchTransactionControl({
  bankTransactionId,
  candidates,
}: {
  bankTransactionId: string;
  candidates: RentSchedule[];
}) {
  const router = useRouter();
  const [rentScheduleId, setRentScheduleId] = useState(candidates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (candidates.length === 0) {
    return (
      <span className="text-xs text-light-textMuted dark:text-dark-textMuted">
        No pending rent due to match
      </span>
    );
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/bank-transactions/${bankTransactionId}/confirm-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentScheduleId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to confirm match.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to confirm match — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={rentScheduleId}
        onChange={(e) => setRentScheduleId(e.target.value)}
        className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
      >
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.dueDate} — R{c.amount.toLocaleString('en-ZA')}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={busy} onClick={confirm}>
        {busy ? 'Matching…' : 'Match'}
      </Button>
      {error ? (
        <span className="text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
          {error}
        </span>
      ) : null}
    </div>
  );
}
