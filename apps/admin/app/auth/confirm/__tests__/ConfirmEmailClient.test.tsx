// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmEmailClient } from '../ConfirmEmailClient';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  global.fetch = originalFetch;
});

// Staff invitation flow audit (this date): `next` is now a required prop, already
// safety-validated by the parent Server Component -- this component must navigate to exactly
// what it was given, on both the "just confirmed" and "already confirmed" success paths, never
// the old hardcoded '/'.
describe('ConfirmEmailClient', () => {
  it('navigates to the given next (an invitation URL) after a successful confirmation', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ outcome: 'success' }),
    }) as unknown as typeof fetch;

    render(<ConfirmEmailClient tokenHash="real-hash" next="/invitations/accept?token=abc-123" />);
    fireEvent.click(screen.getByText('Confirm email address'));

    await waitFor(() => expect(screen.getByText('Email confirmed')).toBeTruthy());
    fireEvent.click(screen.getByText('Continue to Proplyst'));

    expect(replace).toHaveBeenCalledWith('/invitations/accept?token=abc-123');
    expect(refresh).toHaveBeenCalled();
  });

  it('navigates to next on the "already confirmed" path too, not just first-time success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ outcome: 'already_confirmed' }),
    }) as unknown as typeof fetch;

    render(<ConfirmEmailClient tokenHash="real-hash" next="/onboarding/choose-plan?plan=starter&interval=monthly" />);
    fireEvent.click(screen.getByText('Confirm email address'));

    await waitFor(() => expect(screen.getByText('Email already confirmed')).toBeTruthy());
    fireEvent.click(screen.getByText('Continue to Proplyst'));

    expect(replace).toHaveBeenCalledWith('/onboarding/choose-plan?plan=starter&interval=monthly');
  });

  it('defaults to / for an ordinary generic signup with no invitation/plan context', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ outcome: 'success' }),
    }) as unknown as typeof fetch;

    render(<ConfirmEmailClient tokenHash="real-hash" next="/" />);
    fireEvent.click(screen.getByText('Confirm email address'));

    await waitFor(() => expect(screen.getByText('Email confirmed')).toBeTruthy());
    fireEvent.click(screen.getByText('Continue to Proplyst'));

    expect(replace).toHaveBeenCalledWith('/');
  });

  it('a used_or_expired outcome never navigates anywhere -- offers sign-in/resend instead', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ outcome: 'used_or_expired' }),
    }) as unknown as typeof fetch;

    render(<ConfirmEmailClient tokenHash="real-hash" next="/invitations/accept?token=abc-123" />);
    fireEvent.click(screen.getByText('Confirm email address'));

    await waitFor(() => expect(screen.getByText('Confirmation link expired')).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
  });
});
