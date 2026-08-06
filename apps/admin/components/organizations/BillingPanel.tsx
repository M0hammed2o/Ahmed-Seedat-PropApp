'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminRole } from '@propvault/types';
import { Button } from '@/components/ui/Button';

interface Plan {
  id: string;
  code: string;
  name: string;
  basePrice: number;
}

interface SubscriptionPayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  providerReference: string | null;
  paidAt: string | null;
  createdAt: string;
}

// "Super Admin visibility of payment state" -- shows subscription_payments history and lets
// super_admin trigger the mock BillingGatewayProvider's checkout/cancel actions. Never activates
// real billing (apps/admin/lib/providers/billing.ts is mock-only until a real gateway account
// exists).
export function BillingPanel({
  orgId,
  currentUserRole,
}: {
  orgId: string;
  currentUserRole: AdminRole;
}) {
  const router = useRouter();
  const canManageBilling = currentUserRole === 'super_admin';

  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/admin/plans')
      .then((r) => r.json())
      .then((body) => {
        setPlans(body.plans ?? []);
        setSelectedPlanId(body.plans?.[0]?.id ?? '');
      })
      .catch(() => setPlans([]));

    fetch(`/api/v1/admin/organizations/${orgId}/billing/payments`)
      .then((r) => r.json())
      .then((body) => setPayments(body.subscriptionPayments ?? []))
      .catch(() => setPayments([]));
  }, [orgId]);

  async function startCheckout() {
    if (!selectedPlanId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/admin/organizations/${orgId}/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlanId,
          idempotencyKey: `checkout-${orgId}-${Date.now()}`,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to start checkout.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to start checkout — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelSubscription(providerReference: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/admin/organizations/${orgId}/billing/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerSubscriptionId: providerReference }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to cancel subscription.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to cancel subscription — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const latestPayment = payments[0];

  return (
    <div className="mt-6 rounded-lg border border-light-border p-4 dark:border-dark-border">
      <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Billing
      </p>

      {error ? (
        <p className="mt-2 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
          {error}
        </p>
      ) : null}

      {canManageBilling ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={selectedPlanId}
            onChange={(e) => setSelectedPlanId(e.target.value)}
            className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — R{p.basePrice}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={busy || !selectedPlanId} onClick={startCheckout}>
            {busy ? 'Starting…' : 'Start checkout'}
          </Button>
          {latestPayment?.providerReference ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => cancelSubscription(latestPayment.providerReference!)}
            >
              Cancel subscription
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
          Only super_admin can start checkout or cancel a subscription.
        </p>
      )}

      <table className="mt-4 w-full text-xs">
        <thead>
          <tr className="border-b border-light-border text-left text-light-textSecondary dark:border-dark-border dark:text-dark-textSecondary">
            <th className="py-1.5 font-medium">Date</th>
            <th className="py-1.5 font-medium">Amount</th>
            <th className="py-1.5 font-medium">Status</th>
            <th className="py-1.5 font-medium">Provider reference</th>
          </tr>
        </thead>
        <tbody>
          {payments.length === 0 ? (
            <tr>
              <td
                colSpan={4}
                className="py-3 text-center text-light-textMuted dark:text-dark-textMuted"
              >
                No billing history yet.
              </td>
            </tr>
          ) : (
            payments.map((p) => (
              <tr key={p.id} className="border-b border-light-border dark:border-dark-border">
                <td className="py-1.5 text-light-textPrimary dark:text-dark-textPrimary">
                  {new Date(p.createdAt).toLocaleDateString('en-ZA')}
                </td>
                <td className="py-1.5 text-light-textPrimary dark:text-dark-textPrimary">
                  {p.currency} {p.amount.toLocaleString('en-ZA')}
                </td>
                <td className="py-1.5 capitalize text-light-textSecondary dark:text-dark-textSecondary">
                  {p.status}
                </td>
                <td className="py-1.5 text-light-textMuted dark:text-dark-textMuted">
                  {p.providerReference ?? '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
