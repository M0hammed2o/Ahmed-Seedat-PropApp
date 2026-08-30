'use client';

import { useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { formatSouthAfricanNumber } from '@propvault/utils';
import type { StatusPresentation } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';

// Landlord rent-invoicing pass (WORKLOG.md this date): display row combining invoices with its
// lease -> unit -> property and tenant, plus paid/balance/display-status computed server-side from
// the SAME rent_schedules + matched bank_transactions/cash_receipts figures rent-due/property
// accounting already use (never a second, independently-derived total) -- see
// accounting/invoices/page.tsx's loadInvoices().
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
  displayStatus: 'Draft' | 'Issued' | 'Partially paid' | 'Paid' | 'Overdue';
  emailedAt: string | null;
}

const STATUS_PRESENTATION: Record<InvoiceRow['displayStatus'], StatusPresentation> = {
  Draft: { label: 'Draft', icon: 'eye', colorToken: 'statusNeedsReview' },
  Issued: { label: 'Issued', icon: 'spinner', colorToken: 'statusProcessing' },
  'Partially paid': { label: 'Partially paid', icon: 'dot', colorToken: 'statusNeedsReview' },
  Paid: { label: 'Paid', icon: 'check', colorToken: 'statusPaid' },
  Overdue: { label: 'Overdue', icon: 'alert-triangle', colorToken: 'statusOverdue' },
};

function currency(n: number): string {
  return `R${formatSouthAfricanNumber(n)}`;
}

// "Creating an invoice" and "sending it to the tenant" are two distinct, separately-triggered
// actions (task spec: "no automatic tenant contact") -- this button is the only place a landlord
// explicitly chooses to email a tenant an invoice, hitting POST /api/v1/invoices/:id/send.
function SendInvoiceButton({ invoiceId, onSent }: { invoiceId: string; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/invoices/${invoiceId}/send`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to send invoice.');
        return;
      }
      onSent();
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
      {error ? (
        <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error}</p>
      ) : null}
    </div>
  );
}

function buildColumns(canSend: boolean, onSent: () => void): ColumnDef<InvoiceRow, unknown>[] {
  const columns: ColumnDef<InvoiceRow, unknown>[] = [
  {
    header: 'Invoice #',
    accessorKey: 'invoiceNumber',
    cell: (info) => (
      <span className="tabular font-medium text-foreground">{info.row.original.invoiceNumber}</span>
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

  if (canSend) {
    columns.push({
      header: '',
      id: 'actions',
      cell: (info) => {
        const inv = info.row.original;
        if (inv.displayStatus === 'Draft') return null;
        if (inv.emailedAt) {
          return <span className="text-[12px] text-muted-foreground">Sent</span>;
        }
        return <SendInvoiceButton invoiceId={inv.id} onSent={onSent} />;
      },
    });
  }

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
