// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AcceptInviteClient } from '../AcceptInviteClient';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}));

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  global.fetch = originalFetch;
});

describe('AcceptInviteClient', () => {
  it('accepts automatically on mount and shows success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ orgId: 'org-1' }),
    }) as unknown as typeof fetch;

    render(<AcceptInviteClient token="a-real-token" />);

    await waitFor(() => expect(screen.getByText("You're in")).toBeTruthy());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/organizations/invites/accept',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // Staff invitation flow audit (this date): the new seat-check migration's friendly message
  // surfaces here unchanged -- this component already generically displays whatever
  // body.error.message the route returns, so a seat-exhaustion rejection reads as a real,
  // actionable error, never a raw 500 or a silent false-success.
  it('shows the seat-limit-reached message distinctly, without falsely claiming success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: {
          code: 'staff_seat_limit_reached',
          message:
            'This organization has no remaining staff seats available right now. Ask the organization to free up a seat or upgrade their plan, then try again.',
        },
      }),
    }) as unknown as typeof fetch;

    render(<AcceptInviteClient token="a-real-token" />);

    await waitFor(() => expect(screen.getByText("Couldn't accept this invitation")).toBeTruthy());
    expect(screen.getByText(/no remaining staff seats available/)).toBeTruthy();
    expect(screen.queryByText("You're in")).toBeNull();
  });

  it('shows a generic error for an expired/wrong-email/already-used invite', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { code: 'invite_not_found', message: 'Invite not found, expired, or not addressed to your account.' },
      }),
    }) as unknown as typeof fetch;

    render(<AcceptInviteClient token="a-real-token" />);

    await waitFor(() =>
      expect(screen.getByText('Invite not found, expired, or not addressed to your account.')).toBeTruthy(),
    );
  });
});
