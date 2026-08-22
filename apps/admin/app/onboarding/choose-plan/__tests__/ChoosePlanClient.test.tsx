// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChoosePlanClient } from '../ChoosePlanClient';

const PLANS = [
  { code: 'starter_monthly', name: 'Starter', billing_cycle: 'monthly', base_price: 299, currency: 'ZAR', feature_limits: null },
  { code: 'starter_annual', name: 'Starter', billing_cycle: 'annual', base_price: 3050, currency: 'ZAR', feature_limits: null },
  { code: 'professional_monthly', name: 'Professional', billing_cycle: 'monthly', base_price: 699, currency: 'ZAR', feature_limits: null },
  { code: 'professional_annual', name: 'Professional', billing_cycle: 'annual', base_price: 7130, currency: 'ZAR', feature_limits: null },
  { code: 'business_monthly', name: 'Business', billing_cycle: 'monthly', base_price: 1999, currency: 'ZAR', feature_limits: null },
  { code: 'business_annual', name: 'Business', billing_cycle: 'annual', base_price: 20390, currency: 'ZAR', feature_limits: null },
];

const originalLocation = window.location;

beforeEach(() => {
  // A real (non-empty) starting href -- next/image's <Image> internally builds a `new URL(...)`
  // from window.location.href while resolving the ProplystLogo asset; an empty string there
  // throws "Invalid base URL" before the component under test ever renders. Only the later
  // reassignment to the PayFast checkoutUrl is what these tests actually assert on.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, href: 'http://localhost:3000/onboarding/choose-plan' },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

// The tier name (e.g. "Professional") also appears in the Summary panel's "Plan" row once
// selected -- that <dd> is never inside a <button>, so filtering for a <button> ancestor reliably
// isolates the selectable tier CARD from the read-only summary echo.
function getTierCard(name: string): HTMLElement {
  const card = screen.getAllByText(name).map((el) => el.closest('button')).find(Boolean);
  if (!card) throw new Error(`No tier card button found for "${name}"`);
  return card;
}

describe('ChoosePlanClient', () => {
  it('generic entry (no preselection) defaults to Professional/Monthly and shows no "preselected" indicator', () => {
    render(<ChoosePlanClient plans={PLANS} initialTier={null} initialInterval={null} />);
    expect(screen.queryByText(/Preselected from the plan you picked/)).toBeNull();
    expect(getTierCard('Professional').getAttribute('aria-pressed')).toBe('true');
    const monthlyToggle = screen.getByText('Monthly');
    expect(monthlyToggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('plan-specific entry preselects the given tier + interval and shows the preselected indicator, but leaves it changeable', () => {
    render(<ChoosePlanClient plans={PLANS} initialTier="starter" initialInterval="annual" />);
    expect(screen.getByText(/Preselected from the plan you picked/)).toBeTruthy();
    expect(getTierCard('Starter').getAttribute('aria-pressed')).toBe('true');
    const annualToggle = screen.getByText('Annual — Save 15%');
    expect(annualToggle.getAttribute('aria-pressed')).toBe('true');

    // Still changeable -- clicking Business switches the selection away from the preselected tier.
    fireEvent.click(getTierCard('Business'));
    expect(getTierCard('Business').getAttribute('aria-pressed')).toBe('true');
    expect(getTierCard('Starter').getAttribute('aria-pressed')).toBe('false');
  });

  it('the checkout CTA stays disabled until an organization name is entered', () => {
    render(<ChoosePlanClient plans={PLANS} initialTier="professional" initialInterval="monthly" />);
    const cta = screen.getByText('Continue to secure checkout').closest('button')!;
    expect(cta.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Organization / agency name'), {
      target: { value: 'Seedat Property Management' },
    });
    expect(cta.disabled).toBe(false);
  });

  it('creates the organization, then starts trial-activation checkout, then navigates to the returned checkoutUrl -- never sends a price/amount', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/organizations') {
        const body = JSON.parse(init!.body as string);
        expect(body).toEqual({ legalName: 'Seedat Property Management', orgType: 'owner_managed' });
        expect(body).not.toHaveProperty('price');
        expect(body).not.toHaveProperty('amount');
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'org-123', legalName: 'Seedat Property Management' }),
        });
      }
      if (url === '/api/v1/organizations/org-123/billing/trial-activation') {
        const body = JSON.parse(init!.body as string);
        expect(body.planTier).toBe('professional');
        expect(body.interval).toBe('annual');
        expect(body).not.toHaveProperty('price');
        expect(body).not.toHaveProperty('amount');
        return Promise.resolve({
          ok: true,
          json: async () => ({
            checkoutUrl: 'https://www.payfast.co.za/eng/process?mock=1',
            providerSubscriptionId: 'sub-1',
            subscriptionPaymentId: 'pay-1',
          }),
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChoosePlanClient plans={PLANS} initialTier="professional" initialInterval="annual" />);
    fireEvent.change(screen.getByLabelText('Organization / agency name'), {
      target: { value: 'Seedat Property Management' },
    });
    fireEvent.click(screen.getByText('Continue to secure checkout'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(window.location.href).toBe('https://www.payfast.co.za/eng/process?mock=1'),
    );
  });

  it('does not re-create the organization on a retry after a failed checkout attempt', async () => {
    let orgCreateCalls = 0;
    let checkoutCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/v1/organizations') {
        orgCreateCalls += 1;
        return Promise.resolve({ ok: true, json: async () => ({ id: 'org-456' }) });
      }
      if (url === '/api/v1/organizations/org-456/billing/trial-activation') {
        checkoutCalls += 1;
        if (checkoutCalls === 1) {
          return Promise.resolve({
            ok: false,
            json: async () => ({ error: { message: 'Checkout failed.' } }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ checkoutUrl: 'https://www.payfast.co.za/eng/process?mock=2' }),
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChoosePlanClient plans={PLANS} initialTier="starter" initialInterval="monthly" />);
    fireEvent.change(screen.getByLabelText('Organization / agency name'), {
      target: { value: 'Retry Org' },
    });

    fireEvent.click(screen.getByText('Continue to secure checkout'));
    await waitFor(() => expect(screen.getByText('Checkout failed.')).toBeTruthy());

    fireEvent.click(screen.getByText('Continue to secure checkout'));
    await waitFor(() =>
      expect(window.location.href).toBe('https://www.payfast.co.za/eng/process?mock=2'),
    );

    expect(orgCreateCalls).toBe(1);
    expect(checkoutCalls).toBe(2);
  });
});
