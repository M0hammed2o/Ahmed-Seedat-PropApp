// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ActivateClient } from '../ActivateClient';

const getUser = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabaseClient: () => ({ auth: { getUser } }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
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

  // Tenant onboarding completion pass (WORKLOG.md this date), Phase 2: safe activation context.
  it("shows org-only context before authentication (never property/unit pre-auth, matching the API's own safe-context response)", async () => {
    searchParams = new URLSearchParams('token=abc123');
    getUser.mockResolvedValueOnce({ data: { user: null } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          orgName: 'Musgrave Property Group',
          propertyLabel: null,
          unitLabel: null,
        }),
      }),
    );

    render(<ActivateClient />);

    await waitFor(() =>
      expect(screen.getByText(/Managed by: Musgrave Property Group/)).toBeTruthy(),
    );
    expect(screen.queryByText(/Property:/)).toBeNull();
    expect(screen.getByText('Sign in')).toBeTruthy();
  });

  it('shows property/unit context once authenticated, and lands on /portal (not /my-lease) after successful activation', async () => {
    searchParams = new URLSearchParams('token=abc123');
    getUser.mockResolvedValueOnce({ data: { user: { id: 'user-1' } } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown) => {
        if (typeof url === 'string' && url.includes('/tenant-invitations/context')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              valid: true,
              orgName: 'Musgrave Property Group',
              propertyLabel: 'Musgrave Flats',
              unitLabel: 'Unit 601',
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ tenantId: 'tenant-1' }) });
      }),
    );

    render(<ActivateClient />);

    await waitFor(() => expect(screen.getByText('Go to my portal')).toBeTruthy());
    expect(screen.getByText(/Property: Musgrave Flats/)).toBeTruthy();
    expect(screen.getByText(/Unit: Unit 601/)).toBeTruthy();

    fireEvent.click(screen.getByText('Go to my portal'));
    expect(replace).toHaveBeenCalledWith('/portal');
  });

  it('never blocks the accept flow when the context preview fetch fails', async () => {
    searchParams = new URLSearchParams('token=abc123');
    getUser.mockResolvedValueOnce({ data: { user: { id: 'user-1' } } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown) => {
        if (typeof url === 'string' && url.includes('/tenant-invitations/context')) {
          return Promise.reject(new Error('network error'));
        }
        return Promise.resolve({ ok: true, json: async () => ({ tenantId: 'tenant-1' }) });
      }),
    );

    render(<ActivateClient />);

    await waitFor(() => expect(screen.getByText('Go to my portal')).toBeTruthy());
  });
});
