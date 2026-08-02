'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

// Create-only (POST /api/v1/expenses always inserts status='pending' -- recording is the separate
// RecordExpenseButton action). No vendorId picker: optional on the schema, but no Vendors module
// UI exists yet to pick from (same "skip pickers with no UI yet" judgment as every other form
// this milestone). No document/receipt upload either -- that depends on the Documents/OCR module
// (M11/M12), not yet wired into any page.

interface ExpenseFormProps {
  orgId: string;
  properties: { id: string; nickname: string }[];
}

export function ExpenseForm({ orgId, properties }: ExpenseFormProps) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await fetch('/api/v1/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, propertyId, category, amount: Number(amount) }),
      });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? 'Failed to record expense.');
        return;
      }
      router.push(`/accounting/expenses/${body.expense.id}`);
      router.refresh();
    } catch {
      setError('Failed to record expense — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (properties.length === 0) {
    return (
      <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Add a property first — expenses must be linked to one.
      </p>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Add expense</h1>

      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Property</span>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className={inputClass}
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nickname}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Category</span>
          <input
            required
            maxLength={100}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
            placeholder="e.g. Plumbing repair"
          />
          {fieldErrors.category?.length ? (
            <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
              {fieldErrors.category[0]}
            </p>
          ) : null}
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Amount (ZAR)</span>
          <input
            required
            type="number"
            min={0}
            step={0.01}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
          {fieldErrors.amount?.length ? (
            <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
              {fieldErrors.amount[0]}
            </p>
          ) : null}
        </label>

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Add expense'}
          </Button>
          <Button type="button" onClick={() => router.push('/accounting/expenses')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
