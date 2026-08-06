'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

export function BankTransactionForm({ bankAccounts }: { bankAccounts: { id: string; bankName: string }[] }) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? '');
  const [transactionDate, setTransactionDate] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/bank-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccountId,
          transactionDate,
          amount: Number(amount),
          description: description || null,
          reference: reference || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to add transaction.');
        return;
      }
      router.push('/accounting/bank-transactions');
      router.refresh();
    } catch {
      setError('Failed to add transaction — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (bankAccounts.length === 0) {
    return (
      <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Add a bank account first — transactions must be linked to one.
      </p>
    );
  }

  return (
    <div>
      <PageHeader title="Add transaction" />
      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Bank account</span>
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={inputClass}>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bankName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Date</span>
          <input
            required
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Amount (ZAR)</span>
          <input required type="number" step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Reference</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
        </label>
        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Add transaction'}
          </Button>
          <Button type="button" onClick={() => router.push('/accounting/bank-transactions')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
