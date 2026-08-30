// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR } from '@propvault/config';
import { CommercialSetupView } from '../CommercialSetupView';

afterEach(() => {
  cleanup();
});

const PLANS = [
  {
    code: 'starter_monthly',
    name: 'Starter',
    billing_cycle: 'monthly',
    base_price: 299,
    currency: 'ZAR',
    feature_limits: null,
  },
  {
    code: 'professional_monthly',
    name: 'Professional',
    billing_cycle: 'monthly',
    base_price: 699,
    currency: 'ZAR',
    feature_limits: null,
  },
  {
    code: 'business_monthly',
    name: 'Business',
    billing_cycle: 'monthly',
    base_price: 1999,
    currency: 'ZAR',
    feature_limits: null,
  },
];

// R0-to-R5 revision (WORKLOG.md this date): the setup screen must clearly disclose the once-off
// card-verification fee as distinct from the free trial and the (later) recurring subscription
// charge -- never a single ambiguous "Due today: R5" with no explanation of what it is.
describe('CommercialSetupView', () => {
  it('discloses the once-off card verification fee distinctly from the free trial and recurring subscription', () => {
    render(<CommercialSetupView orgId="org-1" plans={PLANS} />);

    const feeLabel = `R${TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR.toFixed(2)}`;

    // Explanatory disclosure text, not just a bare number.
    expect(screen.getByText(new RegExp(`once-off ${feeLabel} card verification fee`, 'i'))).toBeTruthy();

    // Summary panel shows the fee and the R0 trial charge as two SEPARATE line items.
    expect(screen.getByText('Card verification fee')).toBeTruthy();
    expect(screen.getByText(`${feeLabel} once-off`)).toBeTruthy();
    expect(screen.getByText('Subscription due today')).toBeTruthy();
    expect(screen.getByText('R0.00')).toBeTruthy();

    // Recurring subscription line reflects the selected (default Professional monthly) plan price,
    // never the verification fee.
    expect(screen.getByText('Recurring subscription')).toBeTruthy();
    expect(screen.getByText(/R699\/mo/)).toBeTruthy();

    // CTA is explicit about what's being charged right now.
    expect(screen.getByRole('button', { name: new RegExp(`Pay ${feeLabel} & start 30-day free trial`, 'i') })).toBeTruthy();

    // Consent text names the once-off charge explicitly, not just "store this payment method".
    expect(screen.getByText(new RegExp(`I authorize the once-off ${feeLabel} card verification charge`, 'i'))).toBeTruthy();
  });

  it('switching plan tier updates the recurring subscription line but not the fixed verification fee', () => {
    render(<CommercialSetupView orgId="org-1" plans={PLANS} />);

    const feeLabel = `R${TRIAL_ACTIVATION_CARD_VERIFICATION_FEE_ZAR.toFixed(2)}`;
    fireEvent.click(screen.getByRole('button', { name: /^Business/ }));

    const recurringLabel = screen.getByText('Recurring subscription');
    const recurringValue = recurringLabel.closest('div')?.querySelector('dd');
    expect(recurringValue?.textContent).toMatch(/^R1[,\s]?999\/mo$/);
    // The verification fee stays fixed regardless of the selected plan.
    expect(screen.getByText(`${feeLabel} once-off`)).toBeTruthy();
  });
});
