'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BankTransaction } from '@propvault/types';
import { Button } from '@/components/ui/Button';

// POST /api/v1/owner-statements/:id/confirm-payout -- same "caller picks the matching bank
// transaction" pattern as MatchTransactionControl (rent-schedule matching); confirm-only, never
// auto-matched, ACCOUNTING.md §8's product principle applied identically here.
export function ConfirmOwnerStatementPayoutControl({
  ownerStatementId,
  candidates,
}: {
  ownerStatementId: string;
  candidates: BankTransaction[];
}) {
  const router = useRouter();
  const [bankTransactionId, setBankTransactionId] = useState(candidates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (candidates.length === 0) {
    return (
      <p className="mt-4 text-xs text-light-textMuted dark:text-dark-textMuted">
        No unmatched outgoing bank transactions to confirm a payout against yet.
      </p>
    );
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/owner-statements/${ownerStatementId}/confirm-payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankTransactionId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to confirm payout.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to confirm payout — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-light-border p-4 dark:border-dark-border">
      <p className="mb-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">Confirm payout</p>
      {error ? (
        <p className="mb-2 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={bankTransactionId}
          onChange={(e) => setBankTransactionId(e.target.value)}
          className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.transactionDate} — R{Math.abs(c.amount).toLocaleString('en-ZA')} {c.description ?? ''}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={busy} onClick={confirm}>
          {busy ? 'Confirming…' : 'Confirm payout'}
        </Button>
      </div>
    </div>
  );
}
