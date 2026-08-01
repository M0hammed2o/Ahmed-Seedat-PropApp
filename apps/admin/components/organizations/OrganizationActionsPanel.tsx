'use client';

import { useState } from 'react';
import type { AdminRole, OrganizationStatus } from '@propvault/types';
import { Button } from '@/components/ui/Button';

// First real wiring of TASKS.md M19's action endpoints into the Super Admin UI
// (DESIGN_SYSTEM.md "Buttons"/"Alerts" -- destructive actions restate the target, inline banners
// for action-level failures rather than a toast that could disappear before the admin reads it).
// The server-side requireRole() check on each endpoint remains the real enforcement
// (API_SPEC.md §11: "never only in the UI") -- role-gating which buttons render here is a UX
// nicety on top of that, not a substitute for it.

const ROLE_RANK: Record<AdminRole, number> = {
  read_only_admin: 0,
  support_admin: 1,
  operations_admin: 2,
  super_admin: 3,
};

function isRoleAtLeast(role: AdminRole, minRole: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

interface OrganizationActionsPanelProps {
  orgId: string;
  legalName: string;
  status: OrganizationStatus;
  currentUserRole: AdminRole;
}

export function OrganizationActionsPanel({
  orgId,
  legalName,
  status,
  currentUserRole,
}: OrganizationActionsPanelProps) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [creditMessage, setCreditMessage] = useState<string | null>(null);

  async function runStatusAction(action: 'activate' | 'suspend' | 'archive', nextStatus: OrganizationStatus) {
    if (action === 'archive' && !window.confirm(`Archive ${legalName}? This removes it from active billing/usage.`)) {
      return;
    }
    setPending(action);
    setError(null);
    try {
      const response = await fetch(`/api/v1/admin/organizations/${orgId}/${action}`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? `Failed to ${action} organization.`);
        return;
      }
      setCurrentStatus(nextStatus);
    } catch {
      setError(`Failed to ${action} organization -- check your connection and try again.`);
    } finally {
      setPending(null);
    }
  }

  async function submitCredit() {
    const amount = Number(creditAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Credit amount must be a positive number.');
      return;
    }
    if (creditReason.trim().length === 0) {
      setError('A reason is required to issue a credit.');
      return;
    }
    setPending('credit');
    setError(null);
    try {
      const response = await fetch(`/api/v1/admin/organizations/${orgId}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, reason: creditReason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to issue credit.');
        return;
      }
      setCreditMessage(`Credit issued -- new promotional credit balance: R${body.subscription.promotionalCredit}`);
      setCreditOpen(false);
      setCreditAmount('');
      setCreditReason('');
    } catch {
      setError('Failed to issue credit -- check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-light-border bg-light-surfaceRaised p-4 dark:border-dark-border dark:bg-dark-surfaceRaised">
      <h2 className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">Actions</h2>
      <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">Current status: {currentStatus}</p>

      {error ? (
        <p className="mt-3 rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}
      {creditMessage ? (
        <p className="mt-3 rounded-md border border-light-statusPaid bg-light-statusPaid/10 px-3 py-2 text-xs text-light-statusPaid dark:border-dark-statusPaid dark:bg-dark-statusPaid/10 dark:text-dark-statusPaid">
          {creditMessage}
        </p>
      ) : null}

      {isRoleAtLeast(currentUserRole, 'support_admin') ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending !== null || currentStatus === 'active'}
            onClick={() => runStatusAction('activate', 'active')}
          >
            {pending === 'activate' ? 'Activating…' : 'Activate'}
          </Button>
          <Button
            size="sm"
            disabled={pending !== null || currentStatus === 'suspended'}
            onClick={() => runStatusAction('suspend', 'suspended')}
          >
            {pending === 'suspend' ? 'Suspending…' : 'Suspend'}
          </Button>
          {isRoleAtLeast(currentUserRole, 'super_admin') ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={pending !== null || currentStatus === 'archived'}
              onClick={() => runStatusAction('archive', 'archived')}
            >
              {pending === 'archive' ? 'Archiving…' : 'Archive'}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-light-textMuted dark:text-dark-textMuted">
          Your role ({currentUserRole}) can view this organization but not change its status.
        </p>
      )}

      {isRoleAtLeast(currentUserRole, 'super_admin') ? (
        <div className="mt-4 border-t border-light-border pt-4 dark:border-dark-border">
          {!creditOpen ? (
            <Button size="sm" onClick={() => setCreditOpen(true)}>
              + Issue credit
            </Button>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="text-xs">
                <span className="text-light-textMuted dark:text-dark-textMuted">Amount (ZAR)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  className="mt-1 block w-32 rounded-md border border-light-border bg-transparent px-2 py-1.5 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
                />
              </label>
              <label className="flex-1 text-xs">
                <span className="text-light-textMuted dark:text-dark-textMuted">Reason</span>
                <input
                  type="text"
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-2 py-1.5 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
                />
              </label>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" disabled={pending !== null} onClick={submitCredit}>
                  {pending === 'credit' ? 'Issuing…' : 'Issue'}
                </Button>
                <Button size="sm" onClick={() => setCreditOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
