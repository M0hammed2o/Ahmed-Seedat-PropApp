'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

/**
 * Client-side actions for the invoice detail page (overnight V1 completion pass, Part B) --
 * issuing a draft, sending an issued invoice, and recording a manual payment. Kept as one small
 * client island so the surrounding page (header, line items, BILL TO block) stays a plain server
 * component; each action hits its own already-RLS-scoped route and calls router.refresh() rather
 * than managing local invoice state, so the page never drifts from the database after an action.
 */
export function IssueInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/invoices/${invoiceId}/issue`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to issue invoice.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to issue invoice -- check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button variant="primary" size="sm" disabled={busy} onClick={issue}>
        {busy ? 'Issuing…' : 'Issue invoice'}
      </Button>
      {error ? <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error}</p> : null}
    </div>
  );
}

export function SendInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const response = await fetch(`/api/v1/invoices/${invoiceId}/send`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        if (body.error?.code === 'tenant_has_no_email') {
          setInfo(body.error.message);
          return;
        }
        setError(body.error?.message ?? 'Failed to send invoice.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to send invoice -- check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button size="sm" disabled={busy} onClick={send}>
        {busy ? 'Sending…' : 'Send invoice'}
      </Button>
      {error ? <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error}</p> : null}
      {info ? <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">{info}</p> : null}
    </div>
  );
}

export function RecordPaymentForm({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Final accounting reconciliation pass: an overpayment is never silently accepted or silently
  // clamped -- the first attempt surfaces the exact shortfall/excess (409 would_overpay) and offers
  // an explicit "Record anyway" confirmation, which resubmits with allowOverpayment: true.
  const [overpayConfirm, setOverpayConfirm] = useState<{ message: string } | null>(null);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Record payment
      </Button>
    );
  }

  async function submit(e: { preventDefault: () => void }, allowOverpayment = false) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (!allowOverpayment) setOverpayConfirm(null);
    try {
      const response = await fetch(`/api/v1/invoices/${invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(amount),
          paidAt,
          method: method || null,
          notes: notes || null,
          allowOverpayment,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.error?.code === 'would_overpay') {
          setOverpayConfirm({ message: body.error.message });
          return;
        }
        setError(body.error?.message ?? 'Failed to record payment.');
        return;
      }
      setOpen(false);
      setAmount('');
      setMethod('');
      setNotes('');
      setOverpayConfirm(null);
      router.refresh();
    } catch {
      setError('Failed to record payment -- check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="max-w-sm" title="Record payment" bodyClassName="p-4">
      <form onSubmit={submit} className="space-y-3">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Amount</span>
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Date paid</span>
          <input
            required
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Method (optional)</span>
          <input
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="e.g. EFT, cash"
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Notes (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </label>

        {overpayConfirm ? (
          <div className="space-y-2 rounded-md border border-light-statusOverdue bg-light-statusOverdue/10 px-3 py-2 dark:border-dark-statusOverdue dark:bg-dark-statusOverdue/10">
            <p className="text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{overpayConfirm.message}</p>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={(e) => submit(e, true)}
            >
              Record anyway (overpayment)
            </Button>
          </div>
        ) : null}

        <div className="flex gap-2 pt-1">
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? 'Saving…' : 'Save payment'}
          </Button>
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      Print / Save as PDF
    </Button>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
