'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';

// Commercial plan restructure (WORKLOG.md this date): source of truth is
// supabase/migrations/20260101000111_commercial_plan_restructure.sql -- keep both in sync if
// pricing/limits/add-ons change there. Annual price = round(monthly * 12 * 0.85), computed and
// disclosed in that same migration; duplicated here as plain numbers (not derived client-side)
// since a public marketing page has no live plans-table read.
const TIERS = [
  {
    id: 'starter',
    name: 'Starter',
    monthlyPrice: 299,
    annualPrice: 3050,
    blurb: 'For a single landlord managing a small portfolio.',
    features: [
      'Up to 5 properties',
      '1 staff seat',
      'Core accounting & leasing',
      'Documents & maintenance',
      'Email communication',
    ],
    addOns: null,
  },
  {
    id: 'professional',
    name: 'Professional',
    monthlyPrice: 699,
    annualPrice: 7130,
    blurb: 'For growing landlords and smaller agencies.',
    features: [
      'Up to 15 properties',
      'Up to 5 staff seats',
      '2 external owners included',
      'Everything in Starter',
      'Document intelligence (OCR)',
      'Advanced reporting & bulk communications',
      'Owner portal',
    ],
    addOns: [
      { label: 'Extra property', price: 99 },
      { label: 'Extra owner', price: 199 },
    ],
    highlighted: true,
  },
  {
    id: 'business',
    name: 'Business',
    monthlyPrice: 1999,
    annualPrice: 20390,
    blurb: 'For property management companies and agencies.',
    features: [
      'Up to 25 properties',
      'Up to 15 staff seats',
      '5 external owners included',
      'Everything in Professional',
      'Multi-owner management',
      'Priority support',
      'Higher bulk communication allowances',
    ],
    addOns: [
      { label: 'Extra property', price: 99 },
      { label: 'Extra owner', price: 199 },
    ],
  },
] as const;

export function PricingSection() {
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');

  return (
    <section id="pricing" className="px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center font-display text-2xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          Simple, transparent pricing
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Every plan starts with a 30-day free trial. Prices in South African Rand.
        </p>

        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setInterval('monthly')}
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
            onClick={() => setInterval('annual')}
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

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`relative rounded-card border p-6 ${
                'highlighted' in tier && tier.highlighted
                  ? 'border-light-accent shadow-glow dark:border-dark-accent'
                  : 'border-light-border dark:border-dark-border'
              } bg-light-surfaceRaised dark:bg-dark-surfaceRaised`}
            >
              {'highlighted' in tier && tier.highlighted ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-light-accent px-3 py-1 text-xs font-semibold text-light-accentContrast dark:bg-dark-accent dark:text-dark-accentContrast">
                  Most Popular
                </span>
              ) : null}
              <h3 className="font-display text-lg font-bold text-light-textPrimary dark:text-dark-textPrimary">
                {tier.name}
              </h3>
              <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
                {tier.blurb}
              </p>
              <p className="mt-4">
                <span className="font-display text-3xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
                  R{interval === 'monthly' ? tier.monthlyPrice : tier.annualPrice}
                </span>
                <span className="text-sm text-light-textMuted dark:text-dark-textMuted">
                  {interval === 'monthly' ? ' / month' : ' / year, billed annually'}
                </span>
              </p>
              <ul className="mt-5 space-y-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <ShieldCheck
                      size={16}
                      className="mt-0.5 shrink-0 text-light-accent dark:text-dark-accent"
                      aria-hidden="true"
                    />
                    {feature}
                  </li>
                ))}
              </ul>
              {tier.addOns ? (
                <div className="mt-5 rounded-lg border border-light-border bg-light-surface p-3 text-xs text-light-textSecondary dark:border-dark-border dark:bg-dark-surface dark:text-dark-textSecondary">
                  <p className="font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                    Need more?
                  </p>
                  {tier.addOns.map((addOn) => (
                    <p key={addOn.label} className="mt-1">
                      {addOn.label}: R{addOn.price}/month
                    </p>
                  ))}
                </div>
              ) : null}
              <Link
                href={`/register?next=${encodeURIComponent(`/onboarding/choose-plan?plan=${tier.id}&interval=${interval}`)}`}
                className="mt-6 block"
              >
                <Button
                  variant={'highlighted' in tier && tier.highlighted ? 'primary' : 'secondary'}
                  className="w-full"
                >
                  Start free trial
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
