'use client';

import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { RentSchedule } from '@propvault/types';
import { RENT_SCHEDULE_STATUS_PRESENTATION } from '@propvault/ui';
import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';

// Rent Due (TASKS.md M20 Accounting slice). "Issue invoice" is the one write action this table
// exposes -- POST /api/v1/rent-schedules/:id/invoice, a thin wrapper over invoice_rent_schedule(),
// which enforces accountant+ internally (has_org_role(..., 'accountant')) regardless of whether
// canPost hides the button here.

function IssueInvoiceButton({ rentScheduleId, onIssued }: { rentScheduleId: string; onIssued: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/rent-schedules/${rentScheduleId}/invoice`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to issue invoice.');
        return;
      }
      onIssued();
    } catch {
      setError('Failed to issue invoice — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button size="sm" disabled={busy} onClick={issue}>
        {busy ? 'Issuing…' : 'Issue invoice'}
      </Button>
      {error ? <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error}</p> : null}
    </div>
  );
}

function buildColumns(canPost: boolean, onIssued: () => void): ColumnDef<RentSchedule, unknown>[] {
  const columns: ColumnDef<RentSchedule, unknown>[] = [
    {
      header: 'Due date',
      accessorKey: 'dueDate',
      cell: (info) => info.getValue() as string,
    },
    {
      header: 'Amount',
      accessorKey: 'amount',
      cell: (info) => `R${(info.getValue() as number).toLocaleString('en-ZA')}`,
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: (info) => (
        <StatusBadge presentation={RENT_SCHEDULE_STATUS_PRESENTATION[info.getValue() as RentSchedule['status']]} />
      ),
    },
  ];

  if (canPost) {
    columns.push({
      header: '',
      id: 'actions',
      cell: (info) =>
        info.row.original.status === 'pending' ? (
          <IssueInvoiceButton rentScheduleId={info.row.original.id} onIssued={onIssued} />
        ) : null,
    });
  }

  return columns;
}

export function RentScheduleTable({
  data,
  canPost,
  onChanged,
}: {
  data: RentSchedule[];
  canPost: boolean;
  onChanged: () => void;
}) {
  return (
    <AdminDataTable
      emptyMessage="No rent due for the selected filter"
      data={data}
      columns={buildColumns(canPost, onChanged)}
    />
  );
}
