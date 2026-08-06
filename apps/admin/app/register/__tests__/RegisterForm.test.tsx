// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RegisterForm } from '../RegisterForm';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/auth/OAuthButtons', () => ({
  OAuthButtons: () => null,
}));

function fillAndSubmit(overrides: Partial<{ email: string; password: string; confirmPassword: string; terms: boolean; privacy: boolean }> = {}) {
  const values = { email: 'new-user@example.com', password: 'a-real-password-1', confirmPassword: 'a-real-password-1', terms: true, privacy: true, ...overrides };
  fireEvent.change(document.querySelector('input[type="email"]')!, { target: { value: values.email } });
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  fireEvent.change(passwordInputs[0]!, { target: { value: values.password } });
  fireEvent.change(passwordInputs[1]!, { target: { value: values.confirmPassword } });
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  if (values.terms) fireEvent.click(checkboxes[0]!);
  if (values.privacy) fireEvent.click(checkboxes[1]!);
  fireEvent.click(screen.getByText('Create account'));
}

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  global.fetch = originalFetch;
});

// Stage 7 (commercial-launch execution plan, TD-31): RegisterForm now calls
// POST /api/v1/auth/signup (rate-limited server route) instead of the Supabase browser client
// directly -- these tests mock global.fetch instead of getBrowserSupabaseClient accordingly.
describe('RegisterForm', () => {
  it('rejects submission when the password and confirmation do not match, without calling fetch', async () => {
    global.fetch = vi.fn();
    render(<RegisterForm />);
    fillAndSubmit({ confirmPassword: 'a-different-password' });

    await waitFor(() => expect(screen.getByText(/Passwords do not match/)).toBeTruthy());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requires accepting both Terms and Privacy before it will submit', async () => {
    global.fetch = vi.fn();
    render(<RegisterForm />);
    fillAndSubmit({ terms: false });

    await waitFor(() => expect(screen.getByText(/You must accept the Terms/)).toBeTruthy());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('on a real duplicate-account error from the server, shows a clear message and does not treat it as success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: 'account_exists', message: 'An account with this email already exists. Try signing in instead.' } }),
    }) as unknown as typeof fetch;
    render(<RegisterForm />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText(/account with this email already exists/)).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows a rate-limit-specific message on a 429', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } }),
    }) as unknown as typeof fetch;
    render(<RegisterForm />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText(/Too many attempts/)).toBeTruthy());
  });

  it('shows the "check your email" state when signup succeeds with no immediate session (email confirmations on)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hasSession: false }) }) as unknown as typeof fetch;
    render(<RegisterForm />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText('Check your email')).toBeTruthy());
  });

  it('redirects immediately when signup returns hasSession: true (email confirmations off)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hasSession: true }) }) as unknown as typeof fetch;
    render(<RegisterForm />);
    fillAndSubmit();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/onboarding/create-organization'));
  });
});
