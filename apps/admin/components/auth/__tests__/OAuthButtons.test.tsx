// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OAuthButtons } from '../OAuthButtons';

const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabaseClient: () => ({ auth: { signInWithOAuth } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OAuthButtons', () => {
  it('renders exactly the two V1 providers, Google and Apple -- never a Microsoft/other button', () => {
    render(<OAuthButtons />);
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(screen.getByText('Continue with Apple')).toBeTruthy();
    expect(screen.queryByText(/Microsoft/i)).toBeNull();
  });

  it('calls signInWithOAuth with the google provider and a redirectTo carrying ?next=', async () => {
    render(<OAuthButtons next="/invitations/accept?token=abc" />);
    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const call = signInWithOAuth.mock.calls[0][0];
    expect(call.provider).toBe('google');
    expect(call.options.redirectTo).toContain('/auth/callback?next=');
    expect(call.options.redirectTo).toContain(encodeURIComponent('/invitations/accept?token=abc'));
  });

  it('shows a friendly error and re-enables the button if the provider call itself fails', async () => {
    signInWithOAuth.mockResolvedValueOnce({ error: { message: 'provider not configured' } });
    render(<OAuthButtons />);
    fireEvent.click(screen.getByText('Continue with Apple'));

    await waitFor(() => expect(screen.getByText(/Apple sign-in is not available right now/)).toBeTruthy());
  });
});
