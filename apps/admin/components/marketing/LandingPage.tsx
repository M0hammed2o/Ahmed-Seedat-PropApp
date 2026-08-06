import Link from 'next/link';
import { Building2, ScanText, Wallet, Wrench, MessageSquare, ShieldCheck } from 'lucide-react';
import { branding } from '@propvault/config';
import { Button } from '@/components/ui/Button';

// Public marketing/landing page (root-domain routing fix, WORKLOG.md this date) -- rendered by
// app/page.tsx only for a genuinely unauthenticated visitor; every authenticated caller is routed
// elsewhere by resolveAuthenticatedDestination() before this ever renders. Reuses this app's
// existing design tokens/components (Button, the light-/dark- Tailwind palette already used by
// LoginForm.tsx/RegisterForm.tsx) rather than introducing a separate visual system -- this is a
// new page, not a redesign of the application.
//
// Feature/pricing copy is sourced from real, already-shipped product state, not invented:
// PRODUCT_SPEC.md §3 (modules) and the three real PayFast-billed tiers seeded by
// supabase/migrations/20260101000075_commercial_billing_foundation.sql -- keep both in sync if
// pricing/features change there.

const FEATURES = [
  {
    icon: Building2,
    title: 'Portfolio & leasing',
    body: 'Properties, units, owners, applications, and leases in one place — with a portfolio map, rent schedules, and tenant screening built in.',
  },
  {
    icon: Wallet,
    title: 'Real double-entry accounting',
    body: 'Rent-due to invoicing, expenses, bank reconciliation, owner statements, trial balance, and a South African tax pack — not a spreadsheet bolted on afterward.',
  },
  {
    icon: Wrench,
    title: 'Maintenance & inspections',
    body: 'A full maintenance board tenants can submit into directly, plus move-in/move-out inspections with dual sign-off.',
  },
  {
    icon: ScanText,
    title: 'Document intelligence',
    body: 'Upload a bill, statement, or lease and let OCR extract the numbers — reviewed, never blindly trusted.',
  },
  {
    icon: MessageSquare,
    title: 'Email & WhatsApp, together',
    body: 'Reach owners and tenants on a shared-number WhatsApp channel alongside comprehensive email notifications.',
  },
  {
    icon: ShieldCheck,
    title: 'Real ownership, real permissions',
    body: 'Shared property ownership with a proper owner portal, property-level access control, and a full audit trail — not an afterthought.',
  },
] as const;

const TIERS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 299,
    blurb: 'For a single landlord managing a small portfolio.',
    features: ['Up to 5 properties', '1 staff seat', 'Core accounting & leasing'],
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 699,
    blurb: 'For growing portfolios and small agencies.',
    features: [
      'Up to 25 properties',
      'Unlimited staff seats',
      'Document intelligence (OCR)',
      'Owner portal',
      'Advanced reporting & bulk communications',
    ],
    highlighted: true,
  },
  {
    id: 'business',
    name: 'Business',
    price: 1499,
    blurb: 'For agencies managing large, multi-owner portfolios.',
    features: [
      'Unlimited properties & staff',
      'Everything in Professional',
      'API access',
      'Priority support',
    ],
  },
] as const;

export function LandingPage() {
  return (
    <div className="min-h-screen bg-light-surface dark:bg-dark-surface">
      <header className="border-b border-light-border dark:border-dark-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast dark:bg-dark-accent dark:text-dark-accentContrast">
              <Building2 size={18} aria-hidden="true" />
            </span>
            <span className="font-display text-lg font-bold text-light-textPrimary dark:text-dark-textPrimary">
              {branding.productName}
            </span>
          </div>
          <nav className="flex items-center gap-4">
            <a
              href="#pricing"
              className="hidden text-sm font-medium text-light-textSecondary hover:text-light-textPrimary dark:text-dark-textSecondary dark:hover:text-dark-textPrimary sm:inline"
            >
              Pricing
            </a>
            <Link
              href="/login"
              className="text-sm font-medium text-light-textSecondary hover:text-light-textPrimary dark:text-dark-textSecondary dark:hover:text-dark-textPrimary"
            >
              Sign in
            </Link>
            <Link href="/register">
              <Button variant="primary" size="sm">
                Start free trial
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-6 py-20 text-center sm:py-28">
          <h1 className="font-display text-4xl font-bold tracking-tight text-light-textPrimary dark:text-dark-textPrimary sm:text-5xl">
            {branding.tagline}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-light-textSecondary dark:text-dark-textSecondary">
            Property management built for South African landlords, property-owning trusts, and
            agencies — real double-entry accounting, shared ownership, and a portal for every owner
            and tenant, in one platform.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register">
              <Button variant="primary" size="lg">
                Start your 30-day free trial
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="secondary" size="lg">
                Sign in
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-xs text-light-textMuted dark:text-dark-textMuted">
            No credit card required to start your trial.
          </p>
        </section>

        <section className="border-t border-light-border bg-light-surfaceRaised px-6 py-16 dark:border-dark-border dark:bg-dark-surfaceRaised">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-center font-display text-2xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
              Everything a property business actually runs on
            </h2>
            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-card border border-light-border bg-light-surface p-6 dark:border-dark-border dark:bg-dark-surface"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-light-accent/10 text-light-accent dark:bg-dark-accent/10 dark:text-dark-accent">
                    <f.icon size={20} aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
                    {f.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-light-textSecondary dark:text-dark-textSecondary">
                    {f.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-center font-display text-2xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
              Simple, transparent pricing
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-center text-sm text-light-textSecondary dark:text-dark-textSecondary">
              Every plan starts with a 30-day free trial. Prices in South African Rand, billed
              monthly.
            </p>
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {TIERS.map((tier) => (
                <div
                  key={tier.id}
                  className={`rounded-card border p-6 ${
                    'highlighted' in tier && tier.highlighted
                      ? 'border-light-accent shadow-glow dark:border-dark-accent'
                      : 'border-light-border dark:border-dark-border'
                  } bg-light-surfaceRaised dark:bg-dark-surfaceRaised`}
                >
                  <h3 className="font-display text-lg font-bold text-light-textPrimary dark:text-dark-textPrimary">
                    {tier.name}
                  </h3>
                  <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
                    {tier.blurb}
                  </p>
                  <p className="mt-4">
                    <span className="font-display text-3xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
                      R{tier.price}
                    </span>
                    <span className="text-sm text-light-textMuted dark:text-dark-textMuted">
                      {' '}
                      / month
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
                  <Link href="/register" className="mt-6 block">
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
      </main>

      <footer className="border-t border-light-border px-6 py-8 dark:border-dark-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs text-light-textMuted dark:text-dark-textMuted sm:flex-row">
          <span>
            © {new Date().getFullYear()} {branding.productName}. All rights reserved.
          </span>
          <div className="flex items-center gap-4">
            <Link
              href="/terms"
              className="hover:text-light-textPrimary dark:hover:text-dark-textPrimary"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="hover:text-light-textPrimary dark:hover:text-dark-textPrimary"
            >
              Privacy
            </Link>
            <Link
              href="/login"
              className="hover:text-light-textPrimary dark:hover:text-dark-textPrimary"
            >
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
