'use client';

import { useCallback, useEffect, useState } from 'react';
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

interface PlanChangeQuote {
  quoteId: string;
  changeType: 'new_subscription' | 'upgrade' | 'downgrade' | 'reactivation' | 'no_change';
  targetPlanId: string;
  amountDueNow: number;
  nextRenewalAmount: number | null;
  currency: string;
  effectiveAt: string;
  expiresAt: string;
}

interface PendingDowngrade {
  billingPlanChangeId: string;
  scheduledPlanId: string;
  effectiveAt: string;
}

function formatMoney(amount: number, currency: string) {
  return `${currency === 'ZAR' ? 'R' : currency + ' '}${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

// PWA_V1_COMPLETION_PLAN.md Stage 4 -- self-serve equivalent of the Super Admin billing panel,
// scoped to the org's own principal instead of platform staff. RELEASE A (V1 Commercial Launch Gap
// Audit): plan changes now go through the server-computed quote-then-confirm flow
// (/api/v1/organizations/:orgId/billing/{quote,confirm-change}, migration 20260101000104) instead
// of jumping straight to a generic checkout -- the customer always sees "Due today" and "From
// [renewal date]" BEFORE anything is charged. Every mutation is re-checked server-side
// (requireBillingPrincipalAccess) -- this component itself enforces nothing.
export function OrganizationBillingView({ organization, plans, subscription, payments }: Props) {
  const router = useRouter();
  const [quoting, setQuoting] = useState<string | null>(null);
  const [quote, setQuote] = useState<PlanChangeQuote | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDowngrade, setPendingDowngrade] = useState<PendingDowngrade | null>(null);
  const [cancellingDowngrade, setCancellingDowngrade] = useState(false);

  /** React #418 fix (WORKLOG.md this date): daysUntil() reads Date.now(), and organization is a
   *  server-fetched prop present on the very first render -- SSR and the client's hydration pass
   *  can genuinely compute a different day count right at a day boundary, the same hydration-
   *  mismatch shape already found and fixed in AppShell.tsx's relativeTime(). Same fix: stay false
   *  through hydration, flip true only in a post-mount effect. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const loadPendingDowngrade = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/v1/organizations/${organization.id}/billing/pending-change`,
      );
      if (!response.ok) return;
      const body = await response.json();
      setPendingDowngrade(body.pendingChange ?? null);
    } catch {
      // Non-critical display data -- a failed fetch just leaves the pending-downgrade panel absent.
    }
  }, [organization.id]);

  useEffect(() => {
    void loadPendingDowngrade();
  }, [loadPendingDowngrade]);

  const currentPlan = subscription ? plans.find((p) => p.id === subscription.planId) : null;
  const pendingDowngradePlan = pendingDowngrade
    ? plans.find((p) => p.id === pendingDowngrade.scheduledPlanId)
    : null;
  const canCancel =
    subscription && (subscription.status === 'active' || subscription.status === 'overdue');

  async function requestQuote(planId: string) {
    setError(null);
    setQuote(null);
    setQuoting(planId);
    try {
      const response = await fetch(`/api/v1/organizations/${organization.id}/billing/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPlanId: planId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not price this plan change.');
        return;
      }
      setQuote(body);
    } catch {
      setError('Could not price this plan change -- check your connection and try again.');
    } finally {
      setQuoting(null);
    }
  }

  async function confirmQuote() {
    if (!quote) return;
    setError(null);
    setConfirming(true);
    try {
      const response = await fetch(
        `/api/v1/organizations/${organization.id}/billing/confirm-change`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quoteId: quote.quoteId, idempotencyKey: crypto.randomUUID() }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not confirm this plan change.');
        return;
      }
      if (body.checkoutUrl) {
        // Real gateway (PayFast): a hosted checkout page for the exact prorated amount. Mock: a
        // local placeholder URL that still navigates, so this flow is exercisable end-to-end
        // without live credentials configured.
        window.location.href = body.checkoutUrl;
        return;
      }
      setQuote(null);
      router.refresh();
      void loadPendingDowngrade();
    } catch {
      setError('Could not confirm this plan change -- check your connection and try again.');
    } finally {
      setConfirming(false);
    }
  }

  async function cancelSubscription() {
    if (
      !window.confirm(
        'Cancel your Proplyst subscription? Your access will be locked at the end of the current billing period.',
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
      setError('Failed to cancel -- check your connection and try again.');
    } finally {
      setCancelling(false);
    }
  }

  async function cancelPendingDowngrade() {
    setError(null);
    setCancellingDowngrade(true);
    try {
      const response = await fetch(
        `/api/v1/organizations/${organization.id}/billing/pending-change`,
        { method: 'DELETE' },
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to cancel the scheduled downgrade.');
        return;
      }
      setPendingDowngrade(null);
      router.refresh();
    } catch {
      setError('Failed to cancel the scheduled downgrade -- check your connection and try again.');
    } finally {
      setCancellingDowngrade(false);
    }
  }

  const quotedPlan = quote ? plans.find((p) => p.id === quote.targetPlanId) : null;

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
            <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
              Subscription status
            </p>
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
            {organization.status === 'trial' && organization.trialEndsAt && mounted ? (
              <p className="mt-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                {daysUntil(organization.trialEndsAt) >= 0
                  ? `Trial ends in ${daysUntil(organization.trialEndsAt)} day${daysUntil(organization.trialEndsAt) === 1 ? '' : 's'}. Choose a plan below to continue without interruption.`
                  : 'Your trial has ended. Choose a plan below to restore full access.'}
              </p>
            ) : null}
            {(organization.status === 'suspended' || organization.status === 'cancelled') &&
            currentPlan ? (
              <p className="mt-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                Your subscription is {organization.status}. Choose a plan below to reactivate.
              </p>
            ) : null}
            {subscription?.currentPeriodEnd ? (
              <p className="mt-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                Renewal date: {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-ZA')}
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

      {pendingDowngrade && pendingDowngradePlan ? (
        <Panel className="border-light-warning dark:border-dark-warning">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                Scheduled plan change
              </p>
              <p className="mt-1 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                Scheduled plan: {pendingDowngradePlan.name}. Effective:{' '}
                {new Date(pendingDowngrade.effectiveAt).toLocaleDateString('en-ZA')}. You keep your
                current plan&rsquo;s access until then.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={cancellingDowngrade}
              onClick={cancelPendingDowngrade}
            >
              {cancellingDowngrade ? 'Cancelling…' : 'Keep current plan'}
            </Button>
          </div>
        </Panel>
      ) : null}

      <Panel>
        <h3 className="mb-3 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          {currentPlan ? 'Change plan' : 'Choose a plan'}
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent =
              currentPlan?.id === plan.id &&
              organization.status !== 'suspended' &&
              organization.status !== 'cancelled';
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
                  disabled={isCurrent || quoting !== null}
                  onClick={() => requestQuote(plan.id)}
                >
                  {isCurrent
                    ? 'Current plan'
                    : quoting === plan.id
                      ? 'Calculating…'
                      : organization.status === 'suspended' || organization.status === 'cancelled'
                        ? 'Reactivate on this plan'
                        : currentPlan
                          ? 'Switch to this plan'
                          : 'Subscribe'}
                </Button>
              </div>
            );
          })}
        </div>
      </Panel>

      {quote && quotedPlan ? (
        <Panel className="border-light-accent dark:border-dark-accent">
          <h3 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Confirm: switch to {quotedPlan.name}
          </h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-light-textMuted dark:text-dark-textMuted">Due today</dt>
            <dd className="text-right font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              {formatMoney(quote.amountDueNow, quote.currency)}
            </dd>
            {quote.nextRenewalAmount !== null ? (
              <>
                <dt className="text-light-textMuted dark:text-dark-textMuted">
                  From {new Date(quote.effectiveAt).toLocaleDateString('en-ZA')}
                </dt>
                <dd className="text-right text-light-textPrimary dark:text-dark-textPrimary">
                  {formatMoney(quote.nextRenewalAmount, quote.currency)}/month
                </dd>
              </>
            ) : null}
          </dl>
          {quote.changeType === 'downgrade' ? (
            <p className="mt-3 text-xs text-light-textSecondary dark:text-dark-textSecondary">
              You keep your current plan&rsquo;s full access until{' '}
              {new Date(quote.effectiveAt).toLocaleDateString('en-ZA')} — no refund is issued for
              the remainder of this billing period.
            </p>
          ) : (
            <p className="mt-3 text-xs text-light-textSecondary dark:text-dark-textSecondary">
              Access to {quotedPlan.name} begins immediately once this is confirmed.
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <Button size="sm" disabled={confirming} onClick={confirmQuote}>
              {confirming ? 'Confirming…' : 'Confirm'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={confirming}
              onClick={() => setQuote(null)}
            >
              Cancel
            </Button>
          </div>
        </Panel>
      ) : null}

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
