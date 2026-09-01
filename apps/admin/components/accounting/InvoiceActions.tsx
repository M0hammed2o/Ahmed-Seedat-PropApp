'use client';

import { useState, type ChangeEvent } from 'react';
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

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'eft', label: 'EFT' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'debit_order', label: 'Debit order' },
  { value: 'bank_deposit', label: 'Bank deposit' },
  { value: 'other', label: 'Other' },
];

/**
 * Record Payment modal (unified invoice-payment ledger, migration 20260101000158). Method is a
 * required select from the same closed set record_invoice_payment() enforces server-side, never a
 * free-text field. Overpayment has no bypass anywhere in this flow -- the RPC refuses it
 * unconditionally, so the 409 would_overpay response is shown as a plain, unrecoverable error
 * (amend the amount or reverse an existing payment), never an "anyway" confirmation.
 *
 * defaultOpen/onDone (P0 correction pass, WORKLOG.md this date): the SAME form the invoice detail
 * page already renders, now also reusable from the Accounting > Invoices row Actions menu without
 * duplicating it -- the menu renders this component pre-opened (defaultOpen) and is told when to
 * dismiss its own wrapping overlay (onDone), fired on both successful submit and Cancel. The
 * detail page passes neither, so its own inline "Record payment" button behaviour is unchanged.
 */
export function RecordPaymentForm({
  invoiceId,
  balance,
  defaultOpen = false,
  onDone,
}: {
  invoiceId: string;
  balance: number;
  defaultOpen?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [amount, setAmount] = useState(() => (balance > 0 ? balance.toFixed(2) : ''));
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('eft');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Record payment
      </Button>
    );
  }

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/invoices/${invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(amount),
          paidAt,
          method,
          reference: reference || null,
          notes: notes || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to record payment.');
        return;
      }
      setOpen(false);
      setReference('');
      setNotes('');
      router.refresh();
      onDone?.();
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
        <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
          Outstanding balance: <span className="tabular font-medium text-light-textPrimary dark:text-dark-textPrimary">R{balance.toFixed(2)}</span>
        </p>
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
          <span className="text-light-textMuted dark:text-dark-textMuted">Payment method</span>
          <select required value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Reference (optional)</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. bank ref, receipt #"
            maxLength={100}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Notes (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </label>

        <div className="flex gap-2 pt-1">
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? 'Saving…' : 'Save payment'}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setOpen(false);
              onDone?.();
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Reverse Payment action (migration 20260101000158). Requires a real reason (matches
 * reverse_invoice_payment()'s own non-empty-reason guard) and an explicit confirmation step before
 * submitting, since a reversal posts a real correcting journal entry and reopens the invoice's
 * balance -- not a quiet undo.
 */
export function ReversePaymentButton({ invoiceId, paymentId }: { invoiceId: string; paymentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-light-danger hover:underline dark:text-dark-danger"
      >
        Reverse
      </button>
    );
  }

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/invoices/${invoiceId}/payments/${paymentId}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to reverse this payment.');
        return;
      }
      setOpen(false);
      setReason('');
      router.refresh();
    } catch {
      setError('Failed to reverse this payment -- check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="mt-2 max-w-sm" title="Reverse payment" bodyClassName="p-3">
      <form onSubmit={submit} className="space-y-2">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
          Posts a correcting journal entry and reopens the invoice balance. This cannot be undone.
        </p>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Reason (required)</span>
          <input
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. EFT bounced, entered in error"
            className={inputClass}
          />
        </label>
        <div className="flex gap-2 pt-1">
          <Button type="submit" size="sm" disabled={busy || reason.trim().length === 0}>
            {busy ? 'Reversing…' : 'Confirm reversal'}
          </Button>
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Void Invoice action (migration 20260101000158). void_invoice() itself refuses an invoice with
 * any active (non-reversed) payment -- this button stays available and simply surfaces that
 * server-side error rather than trying to duplicate the check client-side.
 */
export function VoidInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Void invoice
      </Button>
    );
  }

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/invoices/${invoiceId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to void this invoice.');
        return;
      }
      setOpen(false);
      setReason('');
      router.refresh();
    } catch {
      setError('Failed to void this invoice -- check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="max-w-sm" title="Void invoice" bodyClassName="p-4">
      <form onSubmit={submit} className="space-y-3">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
          The invoice remains visible but is excluded from outstanding-balance totals and can never
          receive a payment again. Any active payment must be reversed first.
        </p>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Reason (required)</span>
          <input
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. tenant vacated, issued in error"
            className={inputClass}
          />
        </label>
        <div className="flex gap-2 pt-1">
          <Button type="submit" size="sm" disabled={busy || reason.trim().length === 0}>
            {busy ? 'Voiding…' : 'Confirm void'}
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

/**
 * Proof of payment (migration 20260101000158): reuses the existing documents/storage system via
 * documents.invoice_payment_id (a locked-context FK, same idiom as maintenanceTicketId/tenantId
 * before it) rather than a new upload path or a raw storage URL on invoice_payments itself.
 */
export function AttachProofOfPaymentButton({
  orgId,
  propertyId,
  categoryId,
  invoicePaymentId,
}: {
  orgId: string;
  propertyId: string;
  categoryId: string;
  invoicePaymentId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('orgId', orgId);
      form.set('propertyId', propertyId);
      form.set('categoryId', categoryId);
      form.set('documentType', 'proof_of_payment');
      form.set('invoicePaymentId', invoicePaymentId);
      const response = await fetch('/api/v1/documents', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to attach proof of payment.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to attach proof of payment -- check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="cursor-pointer text-xs text-light-accent hover:underline dark:text-dark-accent">
        {busy ? 'Attaching…' : 'Attach proof of payment'}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/heic"
          disabled={busy}
          onChange={handleChange}
          className="hidden"
        />
      </label>
      {error ? <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error}</p> : null}
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
