// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CompleteAccountClient } from '../CompleteAccountClient';

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

function fillAndSubmit(overrides: { firstName?: string; lastName?: string; phone?: string } = {}) {
  fireEvent.change(screen.getByLabelText(/first name/i), {
    target: { value: overrides.firstName ?? 'Jane' },
  });
  fireEvent.change(screen.getByLabelText(/last name/i), {
    target: { value: overrides.lastName ?? 'Doe' },
  });
  fireEvent.change(screen.getByLabelText(/phone number/i), {
    target: { value: overrides.phone ?? '0821234567' },
  });
  fireEvent.click(screen.getByText('Continue'));
}

describe('CompleteAccountClient', () => {
  it('submits first name, last name, and phone, then redirects to next on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ profileCompleted: true }),
    }) as unknown as typeof fetch;

    render(<CompleteAccountClient next="/dashboard" />);
    fillAndSubmit();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/profile/complete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe', phone: '0821234567' }),
      }),
    );
  });

  it('shows a phone-specific field error from the server without redirecting', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 'validation_failed',
          field_errors: {
            phone: ['Enter a valid phone number, e.g. 082 123 4567 or +27821234567'],
          },
        },
      }),
    }) as unknown as typeof fetch;

    render(<CompleteAccountClient next="/dashboard" />);
    fillAndSubmit({ phone: 'not-a-phone' });

    await waitFor(() => expect(screen.getByText(/enter a valid phone number/i)).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows a rate-limit message on 429', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    render(<CompleteAccountClient next="/dashboard" />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeTruthy());
  });
});
