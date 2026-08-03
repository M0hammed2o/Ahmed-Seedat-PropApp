// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { LinkedAccountsPanel } from '../LinkedAccountsPanel';

const getUserIdentities = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabaseClient: () => ({ auth: { getUserIdentities } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LinkedAccountsPanel', () => {
  it('offers "Link account" for a provider the user has not connected yet', async () => {
    getUserIdentities.mockResolvedValueOnce({ data: { identities: [] }, error: null });
    render(<LinkedAccountsPanel />);

    await waitFor(() => expect(screen.getAllByText('Link account').length).toBe(2));
  });

  it('shows "Unlink" instead of "Link account" for a provider that is already connected', async () => {
    getUserIdentities.mockResolvedValueOnce({
      data: { identities: [{ identity_id: 'id-1', provider: 'google' }] },
      error: null,
    });
    render(<LinkedAccountsPanel />);

    await waitFor(() => expect(screen.getByText('Unlink')).toBeTruthy());
    expect(screen.getByText('Link account')).toBeTruthy(); // Apple, still unlinked
  });

  it('disables Unlink when it is the caller\'s only identity -- unlinkIdentity() itself requires at least 2', async () => {
    getUserIdentities.mockResolvedValueOnce({
      data: { identities: [{ identity_id: 'id-1', provider: 'google' }] },
      error: null,
    });
    render(<LinkedAccountsPanel />);

    await waitFor(() => expect(screen.getByText('Unlink')).toBeTruthy());
    expect((screen.getByText('Unlink') as HTMLButtonElement).disabled).toBe(true);
  });
});
