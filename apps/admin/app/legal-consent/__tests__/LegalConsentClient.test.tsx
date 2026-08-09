// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LegalConsentClient } from '../LegalConsentClient';

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

describe('LegalConsentClient', () => {
  it('disables the submit button until the checkbox is checked', () => {
    render(<LegalConsentClient next="/dashboard" />);
    const button = screen.getByText('Agree and continue').closest('button');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('never calls the API before the box is checked, and calls it (no client-supplied version) after', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    render(<LegalConsentClient next="/dashboard" />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Agree and continue'));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    // POST with no body -- the server determines the version, never a client-supplied string.
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/legal-consent', { method: 'POST' });
  });

  it('shows an error and does not redirect when the API call fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    render(<LegalConsentClient next="/dashboard" />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Agree and continue'));

    await waitFor(() => expect(screen.getByText(/could not save your acceptance/i)).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
  });
});
