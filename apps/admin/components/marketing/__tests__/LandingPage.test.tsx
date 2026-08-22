// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LandingPage } from '../LandingPage';

afterEach(cleanup);

// Root-domain routing fix (WORKLOG.md this date): pins that the public landing page actually
// offers the four required entry points (sign in, start trial, pricing, product info) rather than
// just rendering "something" -- and that it never contains any authenticated-app-shell content
// (nav sections, org name, dashboard widgets) that would indicate the wrong component rendered.
describe('LandingPage', () => {
  it('offers a sign-in action', () => {
    render(<LandingPage />);
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it('offers a start-free-trial action', () => {
    render(<LandingPage />);
    expect(
      screen.getAllByText(/start.*(free trial|your 30-day free trial)/i).length,
    ).toBeGreaterThan(0);
  });

  it('offers a pricing section with all three real tiers', () => {
    render(<LandingPage />);
    expect(screen.getByText('Starter')).toBeTruthy();
    expect(screen.getByText('Professional')).toBeTruthy();
    expect(screen.getByText('Business')).toBeTruthy();
    expect(screen.getByText('R299')).toBeTruthy();
    expect(screen.getByText('R699')).toBeTruthy();
    expect(screen.getByText('R1999')).toBeTruthy();
  });

  it('never renders internal admin/dashboard shell content', () => {
    render(<LandingPage />);
    expect(screen.queryByText(/platform admin/i)).toBeNull();
    expect(screen.queryByText(/super admin/i)).toBeNull();
  });

  // Public website polish (this date): the real Proplyst logo (an <img> with alt="Proplyst",
  // ProplystLogo/branding/proplyst-logo.png) replaces the generic Building2 icon-badge that used
  // to stand in for branding in the header/footer.
  it('renders the real Proplyst logo, not a generic icon placeholder', () => {
    render(<LandingPage />);
    expect(screen.getAllByAltText('Proplyst').length).toBeGreaterThan(0);
  });

  // Trial copy accuracy (Part C item 7): the old "No credit card required" claim was false --
  // startTrialActivationCheckout() always requires a real, verified payment method before the
  // trial starts. Replaced with accurate wording; the false claim must never reappear.
  it('never claims no payment method is required for the trial', () => {
    render(<LandingPage />);
    expect(screen.queryByText(/no credit card required/i)).toBeNull();
    expect(screen.getByText(/payment method required/i)).toBeTruthy();
    expect(screen.getByText(/no charge today/i)).toBeTruthy();
  });

  // Entry-path preservation audit: each pricing tier's CTA must carry its own plan code + the
  // page's current billing interval into registration via the existing safe `next=` mechanism, so
  // the choice survives the whole auth/consent/profile round trip to /onboarding/choose-plan --
  // the generic header/hero CTAs must NOT carry any plan (nothing was chosen yet).
  it('wires each pricing tier CTA to /onboarding/choose-plan with its own plan + interval via next=, leaving generic CTAs bare', () => {
    render(<LandingPage />);
    const trialLinks = screen.getAllByRole('link', { name: 'Start free trial' });
    const hrefs = trialLinks.map((link) => link.getAttribute('href'));

    expect(
      hrefs.some(
        (href) =>
          href?.startsWith('/register?next=') &&
          href.includes(encodeURIComponent('/onboarding/choose-plan?plan=starter&interval=monthly')),
      ),
    ).toBe(true);
    expect(
      hrefs.some(
        (href) =>
          href?.startsWith('/register?next=') &&
          href.includes(
            encodeURIComponent('/onboarding/choose-plan?plan=professional&interval=monthly'),
          ),
      ),
    ).toBe(true);
    expect(
      hrefs.some(
        (href) =>
          href?.startsWith('/register?next=') &&
          href.includes(encodeURIComponent('/onboarding/choose-plan?plan=business&interval=monthly')),
      ),
    ).toBe(true);

    // The generic header/hero CTAs carry no plan context at all.
    expect(hrefs.some((href) => href === '/register')).toBe(true);
  });
});
