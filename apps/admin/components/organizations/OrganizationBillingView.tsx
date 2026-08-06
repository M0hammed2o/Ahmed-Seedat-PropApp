'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Organization, OrganizationSubscription, Plan } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Pill, statusTone } from '@/components/ui/Pill';

export interface SubscriptionPaymentSummary {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
}

interface Props {
  organization: Organization;
  plans: Plan[];
  subscription: OrganizationSubscription | null;
  payments: SubscriptionPaymentSummary[];
}

function formatMoney(amount: number, currency: string) {
  return `${currency === 'ZAR' ? 'R' : currency + ' '}${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

// PWA_V1_COMPLETION_PLAN.md Stage 4 -- self-serve equivalent of the Super Admin billing panel,
// scoped to the org's own principal instead of platform staff. Every mutation here goes through
// /api/v1/organizations/:orgId/billing/{checkout,cancel} (principal-only, re-checked server-side)
// -- this component itself enforces nothing, matching every other org-settings form in this app.
export function OrganizationBillingView({ organization, plans, subscription, payments }: Props) {
  const router = useRouter();
  const [startingCheckoutFor, setStartingCheckoutFor] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPlan = subscription ? plans.find((p) => p.id === subscription.planId) : null;
  const canCancel =
    subscription && (subscription.status === 'active' || subscription.status === 'overdue');

  async function startCheckout(planId: string) {
    setError(null);
    setStartingCheckoutFor(planId);
    try {
      const response = await fetch(`/api/v1/organizations/${organization.id}/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, idempotencyKey: crypto.randomUUID() }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to start checkout.');
        return;
      }
      // Real gateway (PayFast): a hosted checkout page. Mock: a local placeholder URL that still
      // navigates, so this flow is exercisable end-to-end without live credentials configured.
      window.location.href = body.checkoutUrl;
    } catch {
      setError('Failed to start checkout — check your connection and try again.');
    } finally {
      setStartingCheckoutFor(null);
    }
  }

  async function cancelSubscription() {
    if (
      !window.confirm(
        'Cancel your PropertyVault subscription? Your access will be locked at the end of the current billing period.',
      )
    ) {
      return;
    }
    setError(null);
    setCancelling(true);
    try {
      const response = await fetch(`/api/v1/organizations/${organization.id}/billing/cancel`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to cancel subscription.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to cancel — check your connection and try again.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      <Panel>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-light-textMuted dark:text-dark-textMuted">Current status</p>
            <div className="mt-1 flex items-center gap-2">
              <Pill tone={statusTone(organization.status)} dot>
                {organization.status}
              </Pill>
              {currentPlan ? (
                <span className="text-sm text-light-textPrimary dark:text-dark-textPrimary">
                  {currentPlan.name} — {formatMoney(currentPlan.basePrice, currentPlan.currency)}/
                  {subscription!.billingCycle === 'annual' ? 'year' : 'month'}
                </span>
              ) : null}
            </div>
            {organization.status === 'trial' && organization.trialEndsAt ? (
              <p className="mt-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                {daysUntil(organization.trialEndsAt) >= 0
                  ? `Trial ends in ${daysUntil(organization.trialEndsAt)} day${daysUntil(organization.trialEndsAt) === 1 ? '' : 's'}. Choose a plan below to continue without interruption.`
                  : 'Your trial has ended. Choose a plan below to restore full access.'}
              </p>
            ) : null}
            {subscription?.nextPaymentDate ? (
              <p className="mt-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                Next payment: {new Date(subscription.nextPaymentDate).toLocaleDateString('en-ZA')}
              </p>
            ) : null}
          </div>
          {canCancel ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={cancelling}
              onClick={cancelSubscription}
            >
              {cancelling ? 'Cancelling…' : 'Cancel subscription'}
            </Button>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <h3 className="mb-3 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          {currentPlan ? 'Change plan' : 'Choose a plan'}
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = currentPlan?.id === plan.id;
            return (
              <div
                key={plan.id}
                className={`rounded-card border p-4 ${
                  isCurrent
                    ? 'border-light-accent dark:border-dark-accent'
                    : 'border-light-border dark:border-dark-border'
                }`}
              >
                <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                  {plan.name}
                </p>
                <p className="mt-1 text-lg font-bold text-light-textPrimary dark:text-dark-textPrimary">
                  {formatMoney(plan.basePrice, plan.currency)}
                  <span className="text-xs font-normal text-light-textMuted dark:text-dark-textMuted">
                    /month
                  </span>
                </p>
                <Button
                  className="mt-3 w-full"
                  variant={isCurrent ? 'secondary' : 'primary'}
                  size="sm"
                  disabled={isCurrent || startingCheckoutFor !== null}
                  onClick={() => startCheckout(plan.id)}
                >
                  {isCurrent
                    ? 'Current plan'
                    : startingCheckoutFor === plan.id
                      ? 'Starting…'
                      : currentPlan
                        ? 'Switch to this plan'
                        : 'Subscribe'}
                </Button>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel bodyClassName="p-0">
        <h3 className="px-4 pt-4 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Payment history
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
              <tr>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Date
                </th>
                <th className="px-4 py-3 text-right font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Amount
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-6 text-center text-light-textMuted dark:text-dark-textMuted"
                  >
                    No payments yet.
                  </td>
                </tr>
              ) : (
                payments.map((payment) => (
                  <tr
                    key={payment.id}
                    className="border-b border-light-border last:border-b-0 dark:border-dark-border"
                  >
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                      {new Date(payment.paidAt ?? payment.createdAt).toLocaleDateString('en-ZA')}
                    </td>
                    <td className="px-4 py-3 text-right text-light-textPrimary dark:text-dark-textPrimary">
                      {formatMoney(payment.amount, payment.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={statusTone(payment.status)}>{payment.status}</Pill>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
