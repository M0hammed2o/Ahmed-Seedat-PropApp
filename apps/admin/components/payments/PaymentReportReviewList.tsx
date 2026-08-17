'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PaymentReport } from '@propvault/types';
import { PAYMENT_REPORT_STATUS_PRESENTATION } from '@propvault/ui';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

// WhatsApp V1 final pre-production pass, Phase 2 (WORKLOG.md this date). Shared between the
// staff-facing (/accounting/payment-reports) and owner-facing (/owner-portal/payments) review
// pages -- both call the SAME RLS-scoped GET /api/v1/payment-reports and the SAME confirm/reject
// routes; this component doesn't know or care which identity is viewing it, since
// payment_reports_select_staff_or_owner (migration 20260101000106) already drew that line at the
// data layer. Confirming/rejecting never touches the real accounting ledger -- see
// confirm_payment_report()'s own header comment -- this is acknowledgement, not reconciliation.

export type PaymentReportWithNames = PaymentReport & {
  tenantName: string | null;
  propertyName: string | null;
};

export function PaymentReportReviewList({ reports }: { reports: PaymentReportWithNames[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function confirm(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/payment-reports/${id}/confirm`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to confirm this payment report.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to confirm — check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!reason.trim()) {
      setError('A reason is required to reject a payment report.');
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/payment-reports/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to reject this payment report.');
        return;
      }
      setRejectingId(null);
      setReason('');
      router.refresh();
    } catch {
      setError('Failed to reject — check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (reports.length === 0) {
    return <EmptyState icon={<span className="text-lg">💳</span>} title="No payment reports yet" />;
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
            <tr>
              <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Tenant
              </th>
              <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Property
              </th>
              <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Amount
              </th>
              <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Method
              </th>
              <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Date
              </th>
              <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Reported by
              </th>
              <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Status
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-b border-light-border last:border-0 dark:border-dark-border">
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    {r.tenantName ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    {r.propertyName ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    R{r.amount.toLocaleString('en-ZA')}
                  </td>
                  <td className="px-4 py-3 capitalize text-light-textPrimary dark:text-dark-textPrimary">
                    {r.paymentMethod}
                  </td>
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    {r.paymentDate}
                  </td>
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    {r.reportedByTenant ? 'Tenant' : 'Staff'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge presentation={PAYMENT_REPORT_STATUS_PRESENTATION[r.status]} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status === 'reported' ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busyId === r.id}
                          onClick={() => confirm(r.id)}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          disabled={busyId === r.id}
                          onClick={() => {
                            setRejectingId(rejectingId === r.id ? null : r.id);
                            setReason('');
                            setError(null);
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
                {rejectingId === r.id ? (
                  <tr className="border-b border-light-border last:border-0 dark:border-dark-border">
                    <td
                      colSpan={8}
                      className="bg-light-surfaceStrong px-4 py-3 dark:bg-dark-surfaceStrong"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Reason for rejecting this payment report"
                          maxLength={500}
                          className="block w-full max-w-md rounded-md border border-light-border bg-transparent px-3 py-1.5 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busyId === r.id}
                          onClick={() => reject(r.id)}
                        >
                          Confirm rejection
                        </Button>
                        <Button size="sm" onClick={() => setRejectingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {r.status === 'rejected' && r.rejectionReason ? (
                  <tr className="border-b border-light-border last:border-0 dark:border-dark-border">
                    <td
                      colSpan={8}
                      className="px-4 py-2 text-xs text-light-textMuted dark:text-dark-textMuted"
                    >
                      Rejection reason: {r.rejectionReason}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
