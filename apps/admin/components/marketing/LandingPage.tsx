import Link from 'next/link';
import { ScanText, Wallet, Wrench, MessageSquare, ShieldCheck, Building2 } from 'lucide-react';
import { branding } from '@propvault/config';
import { Button } from '@/components/ui/Button';
import { ProplystLogo } from '@/components/branding/ProplystLogo';
import { PricingSection } from './PricingSection';
import { ProductPreview } from './ProductPreview';
import { Reveal } from './Reveal';

// Public marketing/landing page (root-domain routing fix, WORKLOG.md this date) -- rendered by
// app/page.tsx only for a genuinely unauthenticated visitor; every authenticated caller is routed
// elsewhere by resolveAuthenticatedDestination() before this ever renders. Reuses this app's
// existing design tokens/components (Button, the light-/dark- Tailwind palette already used by
// LoginForm.tsx/RegisterForm.tsx) rather than introducing a separate visual system -- this is a
// new page, not a redesign of the application.
//
// Feature copy is sourced from real, already-shipped product state (PRODUCT_SPEC.md §3). Pricing
// itself lives in the extracted PricingSection.tsx (a client component -- the monthly/annual
// toggle, commercial plan restructure this pass, needs interactivity this server component
// doesn't otherwise require) -- source of truth is
// supabase/migrations/20260101000111_commercial_plan_restructure.sql.
//
// Public website polish (this date): real Proplyst wordmark/logo (ProplystLogo, already used by
// every auth screen) replaces the generic Building2 icon-badge that previously stood in for
// branding here; a stylized ProductPreview and Reveal-wrapped scroll reveals add visual depth
// without any new runtime dependency (Reveal is a plain IntersectionObserver, respects the
// existing global prefers-reduced-motion rule in app/globals.css automatically). No product
// capability copy was invented -- FEATURES below is unchanged from what already shipped.

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

export function LandingPage() {
  return (
    <div className="min-h-screen bg-light-surface dark:bg-dark-surface">
      <header className="sticky top-0 z-10 border-b border-light-border bg-light-surface/90 backdrop-blur dark:border-dark-border dark:bg-dark-surface/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center">
            <ProplystLogo className="h-8 w-auto" />
          </Link>
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
        <section className="relative overflow-hidden px-6 py-20 text-center sm:py-28">
          {/* Restrained ambient depth -- two soft, blurred accent blobs anchored off-center, never
              overlapping the readable text column. Pure CSS, no image asset. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden"
          >
            <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-[80%] rounded-full bg-light-accent/10 blur-3xl dark:bg-dark-accent/10" />
            <div className="absolute -top-10 left-1/2 h-80 w-80 translate-x-[10%] rounded-full bg-light-accent/5 blur-3xl dark:bg-dark-accent/5" />
          </div>

          <div className="relative mx-auto max-w-4xl">
            <Reveal>
              <h1 className="font-display text-4xl font-bold tracking-tight text-light-textPrimary dark:text-dark-textPrimary sm:text-5xl">
                {branding.tagline}
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-lg text-light-textSecondary dark:text-dark-textSecondary">
                Property management built for South African landlords, property-owning trusts, and
                agencies — real double-entry accounting, shared ownership, and a portal for every
                owner and tenant, in one platform.
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
                30-day free trial. Payment method required. No charge today.
              </p>
            </Reveal>

            <Reveal delayMs={150} className="mx-auto mt-14 max-w-3xl text-left">
              <ProductPreview />
            </Reveal>
          </div>
        </section>

        <section className="border-t border-light-border bg-light-surfaceRaised px-6 py-16 dark:border-dark-border dark:bg-dark-surfaceRaised">
          <div className="mx-auto max-w-6xl">
            <Reveal>
              <p className="text-center text-xs font-semibold uppercase tracking-wide text-light-accent dark:text-dark-accent">
                One platform
              </p>
              <h2 className="mt-2 text-center font-display text-2xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
                Everything a property business actually runs on
              </h2>
            </Reveal>
            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title} delayMs={i * 60}>
                  <div className="h-full rounded-card border border-light-border bg-light-surface p-6 dark:border-dark-border dark:bg-dark-surface">
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
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <PricingSection />
      </main>

      <footer className="border-t border-light-border px-6 py-10 dark:border-dark-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <ProplystLogo className="h-6 w-auto opacity-80" />
          </div>
          <div className="flex items-center gap-4 text-xs text-light-textMuted dark:text-dark-textMuted">
            <span>
              © {new Date().getFullYear()} {branding.productName}. All rights reserved.
            </span>
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
