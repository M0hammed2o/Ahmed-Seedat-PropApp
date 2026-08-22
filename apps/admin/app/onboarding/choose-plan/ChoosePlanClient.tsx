'use client';

import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ProplystLogo } from '@/components/branding/ProplystLogo';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import type { PlanTier, Interval } from '@/lib/planSelection';

export type { PlanTier, Interval };
type OrgType = 'owner_managed' | 'agency';

interface PlanRow {
  code: string;
  name: string;
  billing_cycle: string;
  base_price: number;
  currency: string;
  feature_limits: Record<string, unknown> | null;
}

interface Props {
  plans: PlanRow[];
  initialTier: PlanTier | null;
  initialInterval: Interval | null;
}

const TIER_ORDER: PlanTier[] = ['starter', 'professional', 'business'];

// Presentation copy only -- mirrors components/marketing/PricingSection.tsx's own TIERS array
// (same duplication-from-migration-comment convention that file already establishes: a public
// page has no live plans-table read, this onboarding page does, so PRICE below always comes from
// the `plans` prop; only the feature bullet text is static, human-authored copy).
const TIER_COPY: Record<PlanTier, { blurb: string; features: string[]; highlighted?: boolean }> = {
  starter: {
    blurb: 'For a single landlord managing a small portfolio.',
    features: [
      'Up to 5 properties',
      '1 staff seat',
      'Core accounting & leasing',
      'Documents & maintenance',
      'Email communication',
    ],
  },
  professional: {
    blurb: 'For growing landlords and smaller agencies.',
    features: [
      'Up to 15 properties',
      'Up to 5 staff seats',
      '2 external owners included',
      'Document intelligence (OCR)',
      'Advanced reporting & bulk communications',
      'Owner portal',
    ],
    highlighted: true,
  },
  business: {
    blurb: 'For property management companies and agencies.',
    features: [
      'Up to 25 properties',
      'Up to 15 staff seats',
      '5 external owners included',
      'Multi-owner management',
      'Priority support',
      'Higher bulk communication allowances',
    ],
  },
};

function formatMoney(amount: number, currency: string) {
  return `${currency === 'ZAR' ? 'R' : currency + ' '}${amount.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Entry-path preservation audit + commercial onboarding fix (this date). The self-service replacement
 * for landing a brand-new, portfolio-eligible principal directly on the inert create-organization
 * form: plan + billing-interval selection, organization details, and a single CTA that creates the
 * provisional organization (POST /api/v1/organizations, the same create_organization() RPC
 * create-organization/CreateOrganizationForm.tsx already used) and immediately hands off to the
 * existing trial-activation checkout (POST .../billing/trial-activation, reused unchanged from
 * CommercialSetupView.tsx -- no new billing/RPC/RLS surface). Pricing is never trusted from this
 * component: only planTier + interval are sent, exactly like CommercialSetupView already does.
 *
 * `initialTier`/`initialInterval` (already validated against the fixed enum by the server page)
 * only ever pre-select these controls -- the user must still press the CTA to proceed, and can
 * freely change either before doing so.
 */
export function ChoosePlanClient({ plans, initialTier, initialInterval }: Props) {
  const [tier, setTier] = useState<PlanTier>(initialTier ?? 'professional');
  const [interval, setIntervalValue] = useState<Interval>(initialInterval ?? 'monthly');
  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState<OrgType>('owner_managed');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wasPreselected = initialTier !== null;

  const plansByCode = useMemo(() => {
    const map = new Map<string, PlanRow>();
    for (const p of plans) map.set(p.code, p);
    return map;
  }, [plans]);

  const selectedPlan = plansByCode.get(`${tier}_${interval}`) ?? null;
  const canContinue = orgName.trim().length > 0 && !!selectedPlan && !submitting;

  const trialEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  async function handleContinue() {
    if (!canContinue || !selectedPlan) return;
    setSubmitting(true);
    setError(null);
    try {
      // Never re-creates the organization on a retry -- org creation is not idempotent
      // (create_organization() always inserts a new row), so a failed checkout attempt after the
      // org already exists reuses the SAME orgId rather than risking a second org per retry.
      let activeOrgId = orgId;
      if (!activeOrgId) {
        const orgResponse = await fetch('/api/v1/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ legalName: orgName.trim(), orgType }),
        });
        const orgBody = await orgResponse.json().catch(() => null);
        if (!orgResponse.ok) {
          setError(orgBody?.error?.message ?? 'Could not create your organization. Try again.');
          setSubmitting(false);
          return;
        }
        activeOrgId = orgBody.id as string;
        setOrgId(activeOrgId);
      }

      const checkoutResponse = await fetch(
        `/api/v1/organizations/${activeOrgId}/billing/trial-activation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planTier: tier,
            interval,
            idempotencyKey: `${activeOrgId}-trial-activation-${Date.now()}`,
          }),
        },
      );
      const checkoutBody = await checkoutResponse.json().catch(() => null);
      if (!checkoutResponse.ok) {
        setError(checkoutBody?.error?.message ?? 'Could not start checkout. Please try again.');
        setSubmitting(false);
        return;
      }
      window.location.href = checkoutBody.checkoutUrl;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-light-surface px-6 py-12 dark:bg-dark-surface">
      <div className="mx-auto max-w-4xl">
        <div className="flex justify-center">
          <ProplystLogo />
        </div>
        <h1 className="mt-4 text-center font-display text-2xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          Choose your Proplyst plan
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-center text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Every plan starts with a 30-day free trial. Pick a tier and billing interval to continue
          -- you can change plans at any time from your organization's billing settings.
        </p>

        {wasPreselected ? (
          <p className="mx-auto mt-3 w-fit rounded-full border border-light-accent/30 bg-light-accentSoft px-3 py-1 text-center text-xs font-medium text-light-accent dark:border-dark-accent/30 dark:bg-dark-accentSoft dark:text-dark-accent">
            Preselected from the plan you picked -- change it anytime below.
          </p>
        ) : null}

        <div className="mt-8 flex items-center justify-center gap-2">
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

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {TIER_ORDER.map((t) => {
            const plan = plansByCode.get(`${t}_${interval}`);
            const copy = TIER_COPY[t];
            const isSelected = tier === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                aria-pressed={isSelected}
                className={`relative rounded-card border p-5 text-left transition-colors ${
                  isSelected
                    ? 'border-light-accent bg-light-accent/5 shadow-glow dark:border-dark-accent dark:bg-dark-accent/10'
                    : 'border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised'
                }`}
              >
                {copy.highlighted ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-light-accent px-3 py-1 text-xs font-semibold text-light-accentContrast dark:bg-dark-accent dark:text-dark-accentContrast">
                    Most Popular
                  </span>
                ) : null}
                <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                  {plan?.name ?? t}
                </p>
                <p className="mt-1 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                  {copy.blurb}
                </p>
                <p className="mt-3">
                  <span className="text-2xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
                    {plan ? formatMoney(Number(plan.base_price), plan.currency) : '—'}
                  </span>
                  <span className="text-xs font-normal text-light-textMuted dark:text-dark-textMuted">
                    {interval === 'monthly' ? ' /mo' : ' /yr'}
                  </span>
                </p>
                <ul className="mt-3 space-y-1.5 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                  {copy.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5">
                      <ShieldCheck
                        size={13}
                        className="mt-0.5 shrink-0 text-light-accent dark:text-dark-accent"
                        aria-hidden="true"
                      />
                      {f}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Panel title="Your organization" description="Used for billing and staff invitations.">
              <label
                htmlFor="choose-plan-org-name"
                className="block text-xs text-light-textSecondary dark:text-dark-textSecondary"
              >
                Organization / agency name
              </label>
              <input
                id="choose-plan-org-name"
                type="text"
                autoComplete="organization"
                placeholder="e.g. Seedat Property Management"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:ring-dark-accent/10"
              />

              <p className="mt-4 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                What best describes you?
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setOrgType('owner_managed')}
                  aria-pressed={orgType === 'owner_managed'}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    orgType === 'owner_managed'
                      ? 'border-light-accent bg-light-accent/5 dark:border-dark-accent dark:bg-dark-accent/10'
                      : 'border-light-border bg-transparent dark:border-dark-border'
                  }`}
                >
                  <span className="font-medium text-light-textPrimary dark:text-dark-textPrimary">
                    Owner-managed
                  </span>
                  <span className="block text-xs text-light-textSecondary dark:text-dark-textSecondary">
                    my own properties
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setOrgType('agency')}
                  aria-pressed={orgType === 'agency'}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    orgType === 'agency'
                      ? 'border-light-accent bg-light-accent/5 dark:border-dark-accent dark:bg-dark-accent/10'
                      : 'border-light-border bg-transparent dark:border-dark-border'
                  }`}
                >
                  <span className="font-medium text-light-textPrimary dark:text-dark-textPrimary">
                    Agency
                  </span>
                  <span className="block text-xs text-light-textSecondary dark:text-dark-textSecondary">
                    properties for other owners
                  </span>
                </button>
              </div>
            </Panel>

            <Panel className="mt-4">
              <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                30-day free trial
              </p>
              <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
                A payment method is required to start your trial, and <strong>no charge</strong>{' '}
                applies today. Your first recurring charge happens on{' '}
                <strong>{trialEndDate}</strong> only if you don't cancel before then. You'll add
                your payment method securely on the next screen.
              </p>
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
                <dd className="capitalize text-light-textPrimary dark:text-dark-textPrimary">
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
              disabled={!canContinue}
              onClick={handleContinue}
            >
              {submitting ? 'Redirecting…' : 'Continue to secure checkout'}
            </Button>
            <p className="mt-2 text-center text-xs text-light-textMuted dark:text-dark-textMuted">
              Payment method required. No charge today.
            </p>
          </Panel>
        </div>
      </div>
    </main>
  );
}
