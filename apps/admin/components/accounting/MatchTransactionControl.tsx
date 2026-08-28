'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RentSchedule, Expense } from '@propvault/types';
import { Button } from '@/components/ui/Button';

type Destination = 'rent' | 'expense';

// V1 bank matching (TECHNICAL_DEBT_REGISTER.md TD-22, extended this pass with a second real
// destination -- migration 20260101000146). Two destinations only, both confirm-only pickers (no
// automated propose/score step wired in for either, same honest-simplicity call TD-22 already
// made for rent): "Rent" reaches the pre-existing confirm_bank_transaction_match() flow
// unchanged; "Expense" is new, reconciling this transaction against an existing pending expense
// via match_bank_transaction_to_expense(). Every other destination the original spec listed
// (owner-contribution/withdrawal/supplier-payment/refund/other-income/other-expense) is
// deliberately NOT offered here -- they need new chart-of-accounts modelling this pass doesn't
// build.
export function MatchTransactionControl({
  bankTransactionId,
  rentScheduleCandidates,
  pendingExpenseCandidates,
}: {
  bankTransactionId: string;
  rentScheduleCandidates: RentSchedule[];
  pendingExpenseCandidates: Expense[];
}) {
  const router = useRouter();
  const [destination, setDestination] = useState<Destination>(
    rentScheduleCandidates.length > 0 ? 'rent' : 'expense',
  );
  const [rentScheduleId, setRentScheduleId] = useState(rentScheduleCandidates[0]?.id ?? '');
  const [expenseId, setExpenseId] = useState(pendingExpenseCandidates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rentScheduleCandidates.length === 0 && pendingExpenseCandidates.length === 0) {
    return (
      <span className="text-xs text-light-textMuted dark:text-dark-textMuted">
        No pending rent or expenses to match
      </span>
    );
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const path =
        destination === 'rent'
          ? `/api/v1/bank-transactions/${bankTransactionId}/confirm-match`
          : `/api/v1/bank-transactions/${bankTransactionId}/match-expense`;
      const body =
        destination === 'rent' ? { rentScheduleId } : { expenseId };
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseBody = await response.json();
      if (!response.ok) {
        setError(responseBody.error?.message ?? 'Failed to confirm match.');
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
      {rentScheduleCandidates.length > 0 && pendingExpenseCandidates.length > 0 ? (
        <select
          value={destination}
          onChange={(e) => setDestination(e.target.value as Destination)}
          className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
        >
          <option value="rent">Rent</option>
          <option value="expense">Expense</option>
        </select>
      ) : null}

      {destination === 'rent' && rentScheduleCandidates.length > 0 ? (
        <select
          value={rentScheduleId}
          onChange={(e) => setRentScheduleId(e.target.value)}
          className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
        >
          {rentScheduleCandidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.dueDate} — R{c.amount.toLocaleString('en-ZA')}
            </option>
          ))}
        </select>
      ) : null}

      {destination === 'expense' && pendingExpenseCandidates.length > 0 ? (
        <select
          value={expenseId}
          onChange={(e) => setExpenseId(e.target.value)}
          className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
        >
          {pendingExpenseCandidates.map((exp) => (
            <option key={exp.id} value={exp.id}>
              {exp.category} — R{exp.amount.toLocaleString('en-ZA')}
            </option>
          ))}
        </select>
      ) : null}

      {(destination === 'rent' && rentScheduleCandidates.length > 0) ||
      (destination === 'expense' && pendingExpenseCandidates.length > 0) ? (
        <Button size="sm" disabled={busy} onClick={confirm}>
          {busy ? 'Matching…' : 'Match'}
        </Button>
      ) : (
        <span className="text-xs text-light-textMuted dark:text-dark-textMuted">
          No {destination === 'rent' ? 'pending rent' : 'pending expenses'} to match
        </span>
      )}
      {error ? (
        <span className="text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
          {error}
        </span>
      ) : null}
    </div>
  );
}
