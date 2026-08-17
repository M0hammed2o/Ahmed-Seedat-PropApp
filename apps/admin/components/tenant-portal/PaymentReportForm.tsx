'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { PaymentReportMethod } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';

// WhatsApp V1 final pre-production pass, Phase 1 (WORKLOG.md this date). Reuses the exact form
// shell/input styling TenantMaintenanceTicketForm.tsx already established for this portal --
// deliberately not a new visual language for one more form. Posts multipart/form-data (not JSON)
// because of the optional proof-of-payment file, matching POST /api/v1/tenant-portal/payment-
// reports's own documented contract exactly.

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

const todayIso = () => new Date().toISOString().slice(0, 10);

export function PaymentReportForm() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentReportMethod>('eft');
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('amount', amount);
      form.set('paymentMethod', paymentMethod);
      form.set('paymentDate', paymentDate);
      if (file) form.set('file', file);

      const response = await fetch('/api/v1/tenant-portal/payment-reports', {
        method: 'POST',
        body: form,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to report payment.');
        return;
      }
      router.push('/my-payments');
      router.refresh();
    } catch {
      setError('Failed to report payment — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 animate-rise">
      <PageHeader
        title="Report a payment"
        subtitle="Let your property manager know you've made a payment. They'll confirm it once reviewed."
      />

      <Panel className="max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
              {error}
            </p>
          ) : null}
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Amount paid (R)</span>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
              placeholder="e.g. 10650"
            />
          </label>
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Payment method</span>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentReportMethod)}
              className={inputClass}
            >
              <option value="eft">EFT / bank transfer</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Payment date</span>
            <input
              required
              type="date"
              max={todayIso()}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">
              Proof of payment {paymentMethod === 'eft' ? '' : '(optional)'}
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className={`${inputClass} px-2 py-1.5`}
            />
          </label>
          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Report payment'}
            </Button>
            <Button type="button" onClick={() => router.push('/my-payments')}>
              Cancel
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
