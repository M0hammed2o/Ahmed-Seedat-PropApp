'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

type PlanTier = 'starter' | 'professional' | 'business';
type Interval = 'monthly' | 'annual';

interface PlanRow {
  code: string;
  name: string;
  billing_cycle: string;
  base_price: number;
  currency: string;
  feature_limits: Record<string, unknown> | null;
}

interface Props {
  orgId: string;
  plans: PlanRow[];
}

const TIER_ORDER: PlanTier[] = ['starter', 'professional', 'business'];

function formatMoney(amount: number, currency: string) {
  return `${currency === 'ZAR' ? 'R' : currency + ' '}${amount.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Commercial plan restructure -- the minimum production-safe UI for the mandatory plan +
 * payment-method setup step (Phase 7). Deliberately narrow in scope: plan tier + billing
 * interval selection, a summary, and a single CTA that hands off to PayFast's own hosted
 * checkout page (no card fields collected here -- see startTrialActivationCheckout's own
 * comment). Everything the server actually charges is resolved server-side from planTier +
 * interval alone; nothing here is trusted as a price.
 */
export function CommercialSetupView({ orgId, plans }: Props) {
  const [tier, setTier] = useState<PlanTier>('professional');
  const [interval, setIntervalValue] = useState<Interval>('monthly');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plansByCode = useMemo(() => {
    const map = new Map<string, PlanRow>();
    for (const p of plans) map.set(p.code, p);
    return map;
  }, [plans]);

  const selectedPlan = plansByCode.get(`${tier}_${interval}`) ?? null;

  async function handleStartTrial() {
    if (!consent || !selectedPlan) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/organizations/${orgId}/billing/trial-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planTier: tier,
          interval,
          idempotencyKey: `${orgId}-trial-activation-${Date.now()}`,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? 'Could not start checkout. Please try again.');
        setSubmitting(false);
        return;
      }
      window.location.href = body.checkoutUrl;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  const trialEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel>
          <div className="mb-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setIntervalValue('monthly')}
              aria-pressed={interval === 'monthly'}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                interval === 'monthly'
                  ? 'bg-light-accent text-light-accentContrast dark:bg-dark-accent dark:text-dark-accentContrast'
                  : 'text-light-textSecondary dark:text-dark-textSecondary'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setIntervalValue('annual')}
              aria-pressed={interval === 'annual'}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                interval === 'annual'
                  ? 'bg-light-accent text-light-accentContrast dark:bg-dark-accent dark:text-dark-accentContrast'
                  : 'text-light-textSecondary dark:text-dark-textSecondary'
              }`}
            >
              Annual — Save 15%
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {TIER_ORDER.map((t) => {
              const plan = plansByCode.get(`${t}_${interval}`);
              const isSelected = tier === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  aria-pressed={isSelected}
                  className={`rounded-card border p-4 text-left transition-colors ${
                    isSelected
                      ? 'border-light-accent bg-light-accent/5 dark:border-dark-accent dark:bg-dark-accent/10'
                      : 'border-light-border bg-light-surface dark:border-dark-border dark:bg-dark-surface'
                  }`}
                >
                  <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                    {plan?.name ?? t}
                  </p>
                  <p className="mt-1 text-lg font-bold text-light-textPrimary dark:text-dark-textPrimary">
                    {plan ? formatMoney(Number(plan.base_price), plan.currency) : '—'}
                    <span className="text-xs font-normal text-light-textMuted dark:text-dark-textMuted">
                      {interval === 'monthly' ? ' /mo' : ' /yr'}
                    </span>
                  </p>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel>
          <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            A valid payment method is required to start your 30-day free trial.
          </p>
          <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            You will not be charged the subscription fee until the trial ends, unless otherwise
            required by the provider&apos;s verification flow. Your trial runs until{' '}
            <strong>{trialEndDate}</strong>. Cancel any time before then and you won&apos;t be
            charged.
          </p>
          <label className="mt-4 flex items-start gap-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            I authorize Proplyst to securely store this payment method with our payment provider
            and to bill it automatically each billing cycle after my free trial ends, until I
            cancel.
          </label>
        </Panel>
      </div>

      <Panel>
        <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Summary
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-light-textSecondary dark:text-dark-textSecondary">Plan</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">
              {selectedPlan?.name ?? '—'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-light-textSecondary dark:text-dark-textSecondary">Billing</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary capitalize">
              {interval}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-light-textSecondary dark:text-dark-textSecondary">Due today</dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">R0.00</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-light-textSecondary dark:text-dark-textSecondary">
              First billing date
            </dt>
            <dd className="text-light-textPrimary dark:text-dark-textPrimary">{trialEndDate}</dd>
          </div>
        </dl>

        {error ? (
          <p className="mt-3 text-sm text-light-danger dark:text-dark-danger">{error}</p>
        ) : null}

        <Button
          variant="primary"
          className="mt-4 w-full"
          disabled={!consent || !selectedPlan || submitting}
          onClick={handleStartTrial}
        >
          {submitting ? 'Redirecting to PayFast…' : 'Add payment method & start free trial'}
        </Button>
      </Panel>
    </div>
  );
}
