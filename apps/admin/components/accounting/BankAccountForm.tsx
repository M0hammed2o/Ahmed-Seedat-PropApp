'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { BankAccountClass } from '@propvault/types';
import { Button } from '@/components/ui/Button';

export function BankAccountForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [bankName, setBankName] = useState('');
  const [accountClass, setAccountClass] = useState<BankAccountClass>('business');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/bank-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, bankName, accountClass }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to add bank account.');
        return;
      }
      router.push('/accounting/bank-accounts');
      router.refresh();
    } catch {
      setError('Failed to add bank account — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Add bank account</h1>
      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Bank name</span>
          <input
            required
            maxLength={200}
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Account class</span>
          <select value={accountClass} onChange={(e) => setAccountClass(e.target.value as BankAccountClass)} className={inputClass}>
            <option value="business">Business</option>
            <option value="trust">Trust</option>
          </select>
        </label>
        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Add bank account'}
          </Button>
          <Button type="button" onClick={() => router.push('/accounting/bank-accounts')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
