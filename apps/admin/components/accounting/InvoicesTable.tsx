'use client';

import { useState, useRef, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { formatSouthAfricanNumber } from '@propvault/utils';
import type { StatusPresentation } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { RecordPaymentForm } from '@/components/accounting/InvoiceActions';

// Landlord rent-invoicing pass (WORKLOG.md this date): display row combining invoices with its
// lease -> unit -> property and tenant, plus paid/balance/display-status computed server-side by
// lib/invoicing.ts's loadInvoicesWithBalances() -- the one shared computation also behind the
// tenant detail page's Balance stat and Payments tab (never a second, independently-derived total).
export interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  tenantId: string;
  tenantName: string;
  propertyId: string;
  propertyNickname: string;
  unitId: string;
  unitLabel: string;
  description: string;
  period: string;
  issuedAt: string | null;
  amount: number;
  paid: number;
  balance: number;
  displayStatus: 'Draft' | 'Issued' | 'Partially paid' | 'Paid' | 'Overdue' | 'Void';
  emailedAt: string | null;
  voidedAt: string | null;
  source: 'rent_schedule' | 'manual';
}

const STATUS_PRESENTATION: Record<InvoiceRow['displayStatus'], StatusPresentation> = {
  Draft: { label: 'Draft', icon: 'eye', colorToken: 'statusNeedsReview' },
  Issued: { label: 'Issued', icon: 'spinner', colorToken: 'statusProcessing' },
  'Partially paid': { label: 'Partially paid', icon: 'dot', colorToken: 'statusNeedsReview' },
  Paid: { label: 'Paid', icon: 'check', colorToken: 'statusPaid' },
  Overdue: { label: 'Overdue', icon: 'alert-triangle', colorToken: 'statusOverdue' },
  Void: { label: 'Void', icon: 'slash', colorToken: 'statusVoid' },
};

function currency(n: number): string {
  return `R${formatSouthAfricanNumber(n)}`;
}

// One native <details>/<summary> dropdown per row (P0 correction pass, WORKLOG.md this date) --
// state-dependent visibility per state:
//   Draft:            View, Edit, Issue, Void
//   Issued+balance>0: View, Send/Resend, Record payment, View payments, Download PDF,
//                      Void only if zero active payments
//   Paid:             View, View payments, Download PDF, Send/Resend if already emailable
//   Void:             View, View payments, Download PDF
// Write actions (Edit/Issue/Send/Record payment/Void) require canWrite (principal/manager/
// accountant); View/View payments/Download PDF are always visible (agent/viewer stay read-only).
// Record payment renders the EXACT SAME RecordPaymentForm the invoice detail page uses (imported,
// not duplicated), pre-opened in a small overlay dismissed via its own onDone callback.
function InvoiceActionsMenu({
  invoice,
  canWrite,
  onChanged,
}: {
  invoice: InvoiceRow;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const isVoid = invoice.displayStatus === 'Void';
  const isDraft = invoice.displayStatus === 'Draft';
  const isPaid = invoice.displayStatus === 'Paid';
  const isIssuedWithBalance = !isVoid && !isDraft && !isPaid;

  const canEdit = canWrite && isDraft;
  const canIssue = canWrite && isDraft;
  const canSend = canWrite && !isVoid && !isDraft && !invoice.emailedAt;
  const canRecordPayment = canWrite && isIssuedWithBalance;
  // void_invoice() itself refuses an invoice with any active (non-reversed) payment -- offering the
  // action whenever paid=0 lets the RPC's own error surface for the one edge case (an invoice
  // fully covered by a payment that was itself already reversed back to a net-zero paid figure)
  // this simple client-side check cannot distinguish without re-querying invoice_payments.
  const canVoid = canWrite && !isVoid && !isPaid && invoice.paid === 0;

  async function runAction(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/invoices/${invoice.id}${path}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const responseBody = await response.json();
      if (!response.ok) {
        setError(responseBody.error?.message ?? 'Action failed.');
        return;
      }
      detailsRef.current?.removeAttribute('open');
      onChanged();
    } catch {
      setError('Action failed -- check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <details ref={detailsRef} className="relative inline-block text-left">
        <summary className="cursor-pointer list-none rounded-md border border-light-border px-2 py-1 text-xs text-light-textSecondary hover:bg-light-surfaceRaised dark:border-dark-border dark:text-dark-textSecondary dark:hover:bg-dark-surfaceRaised">
          Actions
        </summary>
        <div className="absolute right-0 z-10 mt-1 w-52 rounded-md border border-light-border bg-light-surface py-1 shadow-lg dark:border-dark-border dark:bg-dark-surface">
          <Link
            href={`/accounting/invoices/${invoice.id}`}
            className="block px-3 py-1.5 text-xs text-light-textPrimary hover:bg-light-surfaceRaised dark:text-dark-textPrimary dark:hover:bg-dark-surfaceRaised"
          >
            View invoice
          </Link>
          {canEdit ? (
            <Link
              href={`/accounting/invoices/${invoice.id}/edit`}
              className="block px-3 py-1.5 text-xs text-light-textPrimary hover:bg-light-surfaceRaised dark:text-dark-textPrimary dark:hover:bg-dark-surfaceRaised"
            >
              Edit invoice
            </Link>
          ) : null}
          {canIssue ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => runAction('/issue')}
              className="block w-full px-3 py-1.5 text-left text-xs text-light-textPrimary hover:bg-light-surfaceRaised disabled:opacity-50 dark:text-dark-textPrimary dark:hover:bg-dark-surfaceRaised"
            >
              Issue invoice
            </button>
          ) : null}
          {canSend ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => runAction('/send')}
              className="block w-full px-3 py-1.5 text-left text-xs text-light-textPrimary hover:bg-light-surfaceRaised disabled:opacity-50 dark:text-dark-textPrimary dark:hover:bg-dark-surfaceRaised"
            >
              Send invoice
            </button>
          ) : null}
          {canRecordPayment ? (
            <button
              type="button"
              onClick={() => {
                detailsRef.current?.removeAttribute('open');
                setShowRecordPayment(true);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-light-textPrimary hover:bg-light-surfaceRaised dark:text-dark-textPrimary dark:hover:bg-dark-surfaceRaised"
            >
              Record payment
            </button>
          ) : null}
          {!isDraft ? (
            <Link
              href={`/accounting/invoices/${invoice.id}#payments`}
              className="block px-3 py-1.5 text-xs text-light-textPrimary hover:bg-light-surfaceRaised dark:text-dark-textPrimary dark:hover:bg-dark-surfaceRaised"
            >
              View payments
            </Link>
          ) : null}
          {!isDraft ? (
            <a
              href={`/api/v1/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-1.5 text-xs text-light-textPrimary hover:bg-light-surfaceRaised dark:text-dark-textPrimary dark:hover:bg-dark-surfaceRaised"
            >
              Download PDF
            </a>
          ) : null}
          {canVoid ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('Reason for voiding this invoice:');
                if (reason && reason.trim().length > 0) void runAction('/void', { reason: reason.trim() });
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-light-danger hover:bg-light-surfaceRaised disabled:opacity-50 dark:text-dark-danger dark:hover:bg-dark-surfaceRaised"
            >
              Void invoice
            </button>
          ) : null}
          {error ? <p className="px-3 py-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error}</p> : null}
        </div>
      </details>

      {showRecordPayment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <RecordPaymentForm
            invoiceId={invoice.id}
            balance={invoice.balance}
            defaultOpen
            onDone={() => {
              setShowRecordPayment(false);
              onChanged();
            }}
          />
        </div>
      ) : null}
    </>
  );
}

function buildColumns(canSend: boolean, onSent: () => void): ColumnDef<InvoiceRow, unknown>[] {
  const columns: ColumnDef<InvoiceRow, unknown>[] = [
  {
    header: 'Invoice #',
    accessorKey: 'invoiceNumber',
    cell: (info) => (
      <Link
        href={`/accounting/invoices/${info.row.original.id}`}
        className="tabular font-medium text-foreground hover:underline"
      >
        {info.row.original.invoiceNumber}
      </Link>
    ),
  },
  {
    header: 'Tenant',
    accessorKey: 'tenantName',
    cell: (info) => (
      <Link
        href={`/tenants/${info.row.original.tenantId}`}
        className="text-light-accent hover:underline dark:text-dark-accent"
      >
        {info.row.original.tenantName}
      </Link>
    ),
  },
  {
    header: 'Property',
    accessorKey: 'propertyNickname',
    cell: (info) => (
      <Link
        href={`/properties/${info.row.original.propertyId}`}
        className="text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        {info.row.original.propertyNickname}
      </Link>
    ),
  },
  {
    header: 'Unit',
    accessorKey: 'unitLabel',
  },
  {
    header: 'Description',
    accessorKey: 'description',
  },
  {
    header: 'Issue date',
    accessorKey: 'issuedAt',
    cell: (info) => {
      const value = info.getValue() as string | null;
      return value ? new Date(value).toLocaleDateString('en-ZA') : '—';
    },
  },
  {
    header: 'Due date',
    accessorKey: 'period',
    cell: (info) => new Date(info.getValue() as string).toLocaleDateString('en-ZA'),
  },
  {
    header: 'Amount',
    accessorKey: 'amount',
    cell: (info) => <span className="tabular">{currency(info.getValue() as number)}</span>,
  },
  {
    header: 'Paid',
    accessorKey: 'paid',
    cell: (info) => <span className="tabular">{currency(info.getValue() as number)}</span>,
  },
  {
    header: 'Balance',
    accessorKey: 'balance',
    cell: (info) => {
      const value = info.getValue() as number;
      return (
        <span
          className={`tabular font-medium ${value > 0 ? 'text-light-statusOverdue dark:text-dark-statusOverdue' : 'text-foreground'}`}
        >
          {currency(value)}
        </span>
      );
    },
  },
  {
    header: 'Status',
    accessorKey: 'displayStatus',
    cell: (info) => (
      <StatusBadge presentation={STATUS_PRESENTATION[info.getValue() as InvoiceRow['displayStatus']]} />
    ),
  },
  ];

  columns.push({
    header: '',
    id: 'actions',
    cell: (info) => (
      <InvoiceActionsMenu invoice={info.row.original} canWrite={canSend} onChanged={onSent} />
    ),
  });

  return columns;
}

export function InvoicesTable({
  data,
  canSend = false,
  onSent = () => {},
  emptyMessage = 'No invoices yet',
  emptyAction,
}: {
  data: InvoiceRow[];
  canSend?: boolean;
  onSent?: () => void;
  emptyMessage?: string;
  emptyAction?: ReactNode;
}) {
  return (
    <AdminDataTable
      emptyMessage={emptyMessage}
      emptyAction={emptyAction}
      data={data}
      columns={buildColumns(canSend, onSent)}
    />
  );
}
