// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RegisterForm } from '../RegisterForm';

const signUp = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabaseClient: () => ({ auth: { signUp } }),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RegisterForm', () => {
  it('rejects submission when the password and confirmation do not match, without calling signUp', async () => {
    render(<RegisterForm />);
    fillAndSubmit({ confirmPassword: 'a-different-password' });

    await waitFor(() => expect(screen.getByText(/Passwords do not match/)).toBeTruthy());
    expect(signUp).not.toHaveBeenCalled();
  });

  it('requires accepting both Terms and Privacy before it will submit', async () => {
    render(<RegisterForm />);
    fillAndSubmit({ terms: false });

    await waitFor(() => expect(screen.getByText(/You must accept the Terms/)).toBeTruthy());
    expect(signUp).not.toHaveBeenCalled();
  });

  it('on a real duplicate-account error from Supabase, shows a clear message and does not treat it as success', async () => {
    signUp.mockResolvedValueOnce({ data: { session: null }, error: { message: 'User already registered' } });
    render(<RegisterForm />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText(/account with this email already exists/)).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the "check your email" state when signUp succeeds with no immediate session (email confirmations on)', async () => {
    signUp.mockResolvedValueOnce({ data: { session: null }, error: null });
    render(<RegisterForm />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText('Check your email')).toBeTruthy());
  });

  it('redirects immediately when signUp returns a live session (email confirmations off)', async () => {
    signUp.mockResolvedValueOnce({ data: { session: { access_token: 'x' } }, error: null });
    render(<RegisterForm />);
    fillAndSubmit();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/onboarding/create-organization'));
  });
});
