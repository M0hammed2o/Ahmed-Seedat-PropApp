// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ActivateClient } from '../ActivateClient';

const getUser = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabaseClient: () => ({ auth: { getUser } }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ActivateClient', () => {
  it('shows sign-in/create-account options (never property/lease data) when the caller is signed out', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    render(<ActivateClient />);

    await waitFor(() => expect(screen.getByText('Sign in')).toBeTruthy());
    expect(screen.getByText('Create an account')).toBeTruthy();
    // The whole point of this page: it never renders lease/payment/document content itself.
    expect(screen.queryByText(/lease/i)).toBeNull();
  });

  it('shows the manual code-entry form (code + email) when signed in with no token in the URL', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'user-1' } } });
    render(<ActivateClient />);

    await waitFor(() => expect(screen.getByText('Activate')).toBeTruthy());
    expect(screen.getByText(/Enter the activation code/)).toBeTruthy();
  });

  it('shows a clear error state (with a retry option) when activation fails, never a raw exception', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'user-1' } } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: {
            code: 'invalid_code',
            message: 'That code or email doesn’t match. Double-check and try again.',
          },
        }),
      }),
    );

    render(<ActivateClient />);
    await waitFor(() => expect(screen.getByText('Activate')).toBeTruthy());

    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'WRONGCODE' } });
    fireEvent.change(inputs[1]!, { target: { value: 'tenant@example.com' } });
    fireEvent.click(screen.getByText('Activate'));

    await waitFor(() => expect(screen.getByText(/doesn’t match/)).toBeTruthy());
    expect(screen.getByText('Try a different code')).toBeTruthy();
  });
});
