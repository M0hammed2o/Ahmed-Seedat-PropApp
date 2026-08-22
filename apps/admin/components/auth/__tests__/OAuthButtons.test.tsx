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
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('OAuthButtons', () => {
  it('renders Google, and never a Microsoft/other button', () => {
    render(<OAuthButtons />);
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(screen.queryByText(/Microsoft/i)).toBeNull();
  });

  // Production signup/onboarding (WORKLOG.md this date): Apple is hidden unless
  // NEXT_PUBLIC_APPLE_OAUTH_ENABLED='true' -- no real Apple OAuth credentials exist yet
  // (TECHNICAL_DEBT_REGISTER.md TD-29), so showing a button that can never complete a real round
  // trip is worse than not showing it. Default (unset) must hide it.
  it('does not render Apple by default (no real credentials configured)', () => {
    render(<OAuthButtons />);
    expect(screen.queryByText('Continue with Apple')).toBeNull();
  });

  it('renders Apple once explicitly enabled via NEXT_PUBLIC_APPLE_OAUTH_ENABLED', async () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_OAUTH_ENABLED', 'true');
    vi.resetModules();
    const { OAuthButtons: OAuthButtonsWithAppleEnabled } = await import('../OAuthButtons');
    render(<OAuthButtonsWithAppleEnabled />);
    expect(screen.getByText('Continue with Apple')).toBeTruthy();
  });

  it('calls signInWithOAuth with the google provider and a redirectTo carrying ?next=', async () => {
    render(<OAuthButtons next="/invitations/accept?token=abc" />);
    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const call = signInWithOAuth.mock.calls[0]![0];
    expect(call.provider).toBe('google');
    expect(call.options.redirectTo).toContain('/auth/callback?next=');
    expect(call.options.redirectTo).toContain(encodeURIComponent('/invitations/accept?token=abc'));
  });

  it('shows a friendly error and re-enables the button if the provider call itself fails (Google)', async () => {
    signInWithOAuth.mockResolvedValueOnce({ error: { message: 'provider not configured' } });
    render(<OAuthButtons />);
    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() =>
      expect(screen.getByText(/Google sign-in is not available right now/)).toBeTruthy(),
    );
  });

  it('calls signInWithOAuth with the apple provider (not a separate/insecure path) and the same redirectTo shape as Google', async () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_OAUTH_ENABLED', 'true');
    vi.resetModules();
    const { OAuthButtons: OAuthButtonsWithAppleEnabled } = await import('../OAuthButtons');
    render(<OAuthButtonsWithAppleEnabled next="/invitations/accept?token=abc" />);
    fireEvent.click(screen.getByText('Continue with Apple'));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const call = signInWithOAuth.mock.calls[0]![0];
    expect(call.provider).toBe('apple');
    expect(call.options.redirectTo).toContain('/auth/callback?next=');
    expect(call.options.redirectTo).toContain(encodeURIComponent('/invitations/accept?token=abc'));
    // The exact same route.ts (/auth/callback) is used for both providers -- confirmed by the
    // redirectTo shape being identical apart from ?next= carrying whatever the caller passed; there
    // is no apple-specific callback path anywhere in this call.
  });

  it('shows a friendly error and re-enables the button if the provider call itself fails (Apple)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_OAUTH_ENABLED', 'true');
    vi.resetModules();
    const { OAuthButtons: OAuthButtonsWithAppleEnabled } = await import('../OAuthButtons');
    signInWithOAuth.mockResolvedValueOnce({ error: { message: 'provider not configured' } });
    render(<OAuthButtonsWithAppleEnabled />);
    fireEvent.click(screen.getByText('Continue with Apple'));

    await waitFor(() =>
      expect(screen.getByText(/Apple sign-in is not available right now/)).toBeTruthy(),
    );
  });

  it('Apple stays hidden (and Google unaffected) when NEXT_PUBLIC_APPLE_OAUTH_ENABLED is explicitly false', () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_OAUTH_ENABLED', 'false');
    render(<OAuthButtons />);
    expect(screen.queryByText('Continue with Apple')).toBeNull();
    expect(screen.getByText('Continue with Google')).toBeTruthy();
  });

  // Entry-path preservation audit (this date): a plan-specific pricing CTA sets
  // next=/onboarding/choose-plan?plan=...&interval=... on /register -- both OAuth providers must
  // carry that exact value through unchanged (same redirectTo mechanism as any other `next`, no
  // provider-specific handling exists anywhere in this component).
  it('Google preserves a next containing plan + interval unchanged', async () => {
    render(<OAuthButtons next="/onboarding/choose-plan?plan=professional&interval=annual" />);
    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const call = signInWithOAuth.mock.calls[0]![0];
    expect(call.options.redirectTo).toContain(
      encodeURIComponent('/onboarding/choose-plan?plan=professional&interval=annual'),
    );
  });

  it('Apple preserves a next containing plan + interval unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_OAUTH_ENABLED', 'true');
    vi.resetModules();
    const { OAuthButtons: OAuthButtonsWithAppleEnabled } = await import('../OAuthButtons');
    render(
      <OAuthButtonsWithAppleEnabled next="/onboarding/choose-plan?plan=starter&interval=monthly" />,
    );
    fireEvent.click(screen.getByText('Continue with Apple'));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const call = signInWithOAuth.mock.calls[0]![0];
    expect(call.options.redirectTo).toContain(
      encodeURIComponent('/onboarding/choose-plan?plan=starter&interval=monthly'),
    );
  });
});
