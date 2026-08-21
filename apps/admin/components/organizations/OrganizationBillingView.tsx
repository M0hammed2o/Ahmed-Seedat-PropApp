'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Organization, OrganizationSubscription, Plan } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Pill, statusTone } from '@/components/ui/Pill';
import {
  DowngradeImpactPicker,
  defaultDowngradeSelection,
  type DowngradeImpact,
  type DowngradeSelection,
} from './DowngradeImpactPicker';

export interface SubscriptionPaymentSummary {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
}

export interface SubscriptionInvoiceSummary {
  id: string;
  invoiceNumber: string;
  invoiceType: 'new_subscription' | 'renewal' | 'upgrade' | 'reactivation';
  planName: string | null;
  total: number;
  currency: string;
  status: 'paid' | 'refunded';
  issuedAt: string;
}

export interface PaymentMethodSummary {
  id: string;
  provider: string;
  updatedAt: string;
}

export interface CapacitySummary {
  /** The plan's own base allowance, EXCLUDING purchased add-ons, is `included`. Null = unlimited. */
  properties: { included: number | null; purchased: number; used: number; restricted: number; unitPrice: number | null };
  owners: { included: number | null; purchased: number; used: number; restricted: number; unitPrice: number | null };
  staff: { included: number | null; used: number; suspended: number };
}

interface Props {
  organization: Organization;
  plans: Plan[];
  subscription: OrganizationSubscription | null;
  payments: SubscriptionPaymentSummary[];
  invoices: SubscriptionInvoiceSummary[];
  paymentMethod: PaymentMethodSummary | null;
  capacitySummary: CapacitySummary;
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
  downgradeImpact: DowngradeImpact | null;
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
const INVOICE_TYPE_LABELS: Record<SubscriptionInvoiceSummary['invoiceType'], string> = {
  new_subscription: 'New subscription',
  renewal: 'Renewal',
  upgrade: 'Upgrade',
  reactivation: 'Reactivation',
};

export function OrganizationBillingView({
  organization,
  plans,
  subscription,
  payments,
  invoices,
  paymentMethod,
  capacitySummary,
}: Props) {
  const router = useRouter();
  const [quoting, setQuoting] = useState<string | null>(null);
  const [quote, setQuote] = useState<PlanChangeQuote | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDowngrade, setPendingDowngrade] = useState<PendingDowngrade | null>(null);
  const [cancellingDowngrade, setCancellingDowngrade] = useState(false);
  const [updatingPaymentMethod, setUpdatingPaymentMethod] = useState(false);
  const [downgradeSelection, setDowngradeSelection] = useState<DowngradeSelection | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [addonBusy, setAddonBusy] = useState<'property' | 'owner' | null>(null);

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
  const restrictedTotal =
    capacitySummary.properties.restricted + capacitySummary.owners.restricted + capacitySummary.staff.suspended;

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
      setDowngradeSelection(
        body.downgradeImpact?.requiresSelection ? defaultDowngradeSelection(body.downgradeImpact) : null,
      );
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
          body: JSON.stringify({
            quoteId: quote.quoteId,
            idempotencyKey: crypto.randomUUID(),
            // Explicit selection, shown to and implicitly confirmed by the customer via the
            // picker, when this downgrade puts them over any resource allowance -- never a
            // silent server-side guess. Omitted entirely (server falls back to the deterministic
            // default) when no selection was ever required.
            ...(downgradeSelection
              ? {
                  keepPropertyIds: downgradeSelection.propertyIds,
                  keepOwnerIds: downgradeSelection.ownerIds,
                  keepStaffMemberIds: downgradeSelection.staffMemberIds,
                }
              : {}),
          }),
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
      setDowngradeSelection(null);
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

  async function updatePaymentMethod() {
    setError(null);
    setUpdatingPaymentMethod(true);
    try {
      const response = await fetch(
        `/api/v1/organizations/${organization.id}/billing/payment-method`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not start payment method update.');
        return;
      }
      // Real gateway: a hosted R0 checkout page that verifies the new card. This intentionally
      // never restarts or extends the trial -- see startPaymentMethodUpdateCheckout()'s own
      // billing_date handling (uses the org's existing next_payment_date, never a fresh +30 days).
      window.location.href = body.checkoutUrl;
    } catch {
      setError('Could not start payment method update -- check your connection and try again.');
    } finally {
      setUpdatingPaymentMethod(false);
    }
  }

  async function restoreAccess() {
    setError(null);
    setRestoreNotice(null);
    setRestoring(true);
    try {
      const response = await fetch(
        `/api/v1/organizations/${organization.id}/billing/reconcile-access`,
        { method: 'POST' },
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not restore access.');
        return;
      }
      const stillRestricted =
        (body.restrictedProperties ?? 0) + (body.restrictedOwners ?? 0) + (body.suspendedStaff ?? 0);
      setRestoreNotice(
        stillRestricted === 0
          ? 'All resources restored.'
          : 'Access re-checked -- some resources are still over your plan’s allowance.',
      );
      router.refresh();
    } catch {
      setError('Could not restore access -- check your connection and try again.');
    } finally {
      setRestoring(false);
    }
  }

  async function changeAddonCapacity(
    resourceType: 'property' | 'owner',
    direction: 'add' | 'remove',
  ) {
    const summary = resourceType === 'property' ? capacitySummary.properties : capacitySummary.owners;
    if (summary.unitPrice === null) return;
    const currentTotal = (summary.included ?? 0) + summary.purchased;
    const targetQuantity = direction === 'add' ? summary.purchased + 1 : summary.purchased - 1;
    if (targetQuantity < 0) return;
    const newTotal = (summary.included ?? 0) + targetQuantity;
    const monthlyUnitPrice =
      subscription?.billingCycle === 'annual' ? summary.unitPrice * 12 : summary.unitPrice;
    const cadence = subscription?.billingCycle === 'annual' ? 'year' : 'month';

    const confirmed = window.confirm(
      `${direction === 'add' ? 'Add' : 'Remove'} 1 extra ${resourceType} slot?\n\n` +
        `Current capacity: ${currentTotal}\nNew capacity: ${newTotal}\n` +
        `Add-on cost: ${formatMoney(monthlyUnitPrice, 'ZAR')}/${cadence} per slot\n\n` +
        `This changes your recurring PayFast subscription amount.`,
    );
    if (!confirmed) return;

    setError(null);
    setAddonBusy(resourceType);
    try {
      const response = await fetch(`/api/v1/organizations/${organization.id}/billing/addons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceType,
          targetQuantity,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.error?.code === 'addon_removal_requires_selection') {
          setError(
            'Removing this slot would put you over capacity. Restrict resources first (see the Plan capacity panel above) before removing this add-on.',
          );
        } else {
          setError(body.error?.message ?? 'Could not update add-on capacity.');
        }
        return;
      }
      router.refresh();
    } catch {
      setError('Could not update add-on capacity -- check your connection and try again.');
    } finally {
      setAddonBusy(null);
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

      {organization.status === 'overdue' ? (
        <p className="rounded-md border border-light-warning bg-light-warning/10 px-3 py-2 text-xs text-light-warning dark:border-dark-warning dark:bg-dark-warning/10 dark:text-dark-warning">
          Your last payment didn&rsquo;t go through. Your account keeps full access during a
          7-day grace period, but access will be restricted if it isn&rsquo;t resolved. Update
          your payment method below to fix this.
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

      <Panel>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
              Payment method
            </p>
            {paymentMethod ? (
              <p className="mt-1 text-sm text-light-textPrimary dark:text-dark-textPrimary">
                On file via {paymentMethod.provider === 'payfast' ? 'PayFast' : paymentMethod.provider}
                {mounted
                  ? ` — updated ${new Date(paymentMethod.updatedAt).toLocaleDateString('en-ZA')}`
                  : ''}
              </p>
            ) : (
              <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
                No payment method on file yet.
              </p>
            )}
          </div>
          {paymentMethod ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={updatingPaymentMethod}
              onClick={updatePaymentMethod}
            >
              {updatingPaymentMethod ? 'Redirecting…' : 'Update payment method'}
            </Button>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Plan capacity
          </h3>
          {restrictedTotal > 0 ? (
            <Button variant="secondary" size="sm" disabled={restoring} onClick={restoreAccess}>
              {restoring ? 'Checking…' : 'Restore all'}
            </Button>
          ) : null}
        </div>
        {restoreNotice ? (
          <p className="mt-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
            {restoreNotice}
          </p>
        ) : null}
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CapacityRow
            label="Properties"
            included={capacitySummary.properties.included}
            purchased={capacitySummary.properties.purchased}
            used={capacitySummary.properties.used}
            restricted={capacitySummary.properties.restricted}
            unitPrice={capacitySummary.properties.unitPrice}
            busy={addonBusy === 'property'}
            onAdd={() => changeAddonCapacity('property', 'add')}
            onRemove={() => changeAddonCapacity('property', 'remove')}
          />
          <CapacityRow
            label="Owners"
            included={capacitySummary.owners.included}
            purchased={capacitySummary.owners.purchased}
            used={capacitySummary.owners.used}
            restricted={capacitySummary.owners.restricted}
            unitPrice={capacitySummary.owners.unitPrice}
            busy={addonBusy === 'owner'}
            onAdd={() => changeAddonCapacity('owner', 'add')}
            onRemove={() => changeAddonCapacity('owner', 'remove')}
          />
          <CapacityRow
            label="Staff"
            included={capacitySummary.staff.included}
            purchased={0}
            used={capacitySummary.staff.used}
            restricted={capacitySummary.staff.suspended}
            unitPrice={null}
          />
        </dl>
        {restrictedTotal > 0 ? (
          <p className="mt-3 text-xs text-light-warning dark:text-dark-warning">
            {restrictedTotal} resource{restrictedTotal === 1 ? ' is' : 's are'} currently locked by
            your plan. Nothing was deleted — upgrade, add capacity, or free up a slot, then click
            &ldquo;Restore all&rdquo;.
          </p>
        ) : null}
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
          {quote.changeType === 'downgrade' && new Date(quote.effectiveAt).getTime() > Date.now() ? (
            <p className="mt-3 text-xs text-light-textSecondary dark:text-dark-textSecondary">
              You keep your current plan&rsquo;s full access until{' '}
              {new Date(quote.effectiveAt).toLocaleDateString('en-ZA')} — no refund is issued for
              the remainder of this billing period.
            </p>
          ) : quote.changeType === 'downgrade' ? (
            <p className="mt-3 text-xs text-light-textSecondary dark:text-dark-textSecondary">
              This takes effect immediately — trial access is not charged, so there is no
              remaining paid period to keep. Any resources above {quotedPlan.name}&rsquo;s
              allowance are restricted (never deleted) right away.
            </p>
          ) : (
            <p className="mt-3 text-xs text-light-textSecondary dark:text-dark-textSecondary">
              Access to {quotedPlan.name} begins immediately once this is confirmed.
            </p>
          )}
          {quote.downgradeImpact?.requiresSelection && downgradeSelection ? (
            <DowngradeImpactPicker
              impact={quote.downgradeImpact}
              selection={downgradeSelection}
              onChange={setDowngradeSelection}
            />
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button size="sm" disabled={confirming} onClick={confirmQuote}>
              {confirming ? 'Confirming…' : 'Confirm'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={confirming}
              onClick={() => {
                setQuote(null);
                setDowngradeSelection(null);
              }}
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

      <Panel bodyClassName="p-0">
        <h3 className="px-4 pt-4 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Invoices
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
              <tr>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Invoice
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Date
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Plan
                </th>
                <th className="px-4 py-3 text-right font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Amount
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Status
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  <span className="sr-only">Download</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-light-textMuted dark:text-dark-textMuted"
                  >
                    No invoices yet.
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="border-b border-light-border last:border-b-0 dark:border-dark-border"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-light-textPrimary dark:text-dark-textPrimary">
                      {invoice.invoiceNumber}
                    </td>
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                      {new Date(invoice.issuedAt).toLocaleDateString('en-ZA')}
                    </td>
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                      {invoice.planName ?? '—'}{' '}
                      <span className="text-xs text-light-textMuted dark:text-dark-textMuted">
                        ({INVOICE_TYPE_LABELS[invoice.invoiceType]})
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-light-textPrimary dark:text-dark-textPrimary">
                      {formatMoney(invoice.total, invoice.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={invoice.status === 'paid' ? 'success' : 'warning'}>
                        {invoice.status}
                      </Pill>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/api/v1/organizations/${organization.id}/billing/invoices/${invoice.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-light-accent hover:underline dark:text-dark-accent"
                      >
                        Download PDF
                      </a>
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

function CapacityRow({
  label,
  included,
  purchased,
  used,
  restricted,
  unitPrice,
  busy,
  onAdd,
  onRemove,
}: {
  label: string;
  included: number | null;
  purchased: number;
  used: number;
  restricted: number;
  unitPrice: number | null;
  busy?: boolean;
  onAdd?: () => void;
  onRemove?: () => void;
}) {
  const total = included === null ? null : included + purchased;
  return (
    <div className="rounded-card border border-light-border p-3 dark:border-dark-border">
      <dt className="text-xs text-light-textMuted dark:text-dark-textMuted">{label}</dt>
      <dd className="mt-1 text-sm text-light-textPrimary dark:text-dark-textPrimary">
        <span className="font-semibold">{used}</span> used
        {total !== null ? (
          <>
            {' '}
            / <span className="font-semibold">{total}</span> capacity
            {purchased > 0 ? (
              <span className="text-light-textMuted dark:text-dark-textMuted">
                {' '}
                ({included} included + {purchased} purchased)
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-light-textMuted dark:text-dark-textMuted"> (unlimited)</span>
        )}
      </dd>
      {restricted > 0 ? (
        <dd className="mt-1 text-xs text-light-warning dark:text-dark-warning">
          {restricted} restricted by plan
        </dd>
      ) : null}
      {unitPrice !== null && onAdd && onRemove ? (
        <div className="mt-2 flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={onAdd}>
            + Add ({formatMoney(unitPrice, 'ZAR')}/mo)
          </Button>
          {purchased > 0 ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onRemove}>
              − Remove
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
