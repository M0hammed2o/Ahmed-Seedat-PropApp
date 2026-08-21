// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OverdueBillingBanner } from '../OverdueBillingBanner';

afterEach(() => {
  cleanup();
});

describe('OverdueBillingBanner', () => {
  it('shows the grace-period warning and an update-payment-method link for a principal', () => {
    render(<OverdueBillingBanner canManageBilling />);
    expect(screen.getByText(/7-day grace period/i)).toBeTruthy();
    const link = screen.getByRole('link', { name: /update payment method/i });
    expect(link.getAttribute('href')).toBe('/organization/billing');
  });

  it('shows the warning without an action link for a non-billing-principal viewer', () => {
    render(<OverdueBillingBanner canManageBilling={false} />);
    expect(screen.getByText(/7-day grace period/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /update payment method/i })).toBeNull();
  });
});
