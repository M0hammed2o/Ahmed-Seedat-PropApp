// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CheckEmailScreen } from '../CheckEmailScreen';

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  global.fetch = originalFetch;
});

describe('CheckEmailScreen', () => {
  it('shows the email address it sent the link to', () => {
    render(<CheckEmailScreen email="jane@example.com" next="/" onBackToSignup={() => {}} />);
    expect(screen.getByText('jane@example.com')).toBeTruthy();
  });

  it('resends and then disables the button during the cooldown', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 }) as unknown as typeof fetch;
    render(<CheckEmailScreen email="jane@example.com" next="/" onBackToSignup={() => {}} />);

    fireEvent.click(screen.getByText('Resend verification email'));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/auth/resend-verification',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /resend verification email/i });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('shows a rate-limit message on 429 without starting the cooldown', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 429 }) as unknown as typeof fetch;
    render(<CheckEmailScreen email="jane@example.com" next="/" onBackToSignup={() => {}} />);

    fireEvent.click(screen.getByText('Resend verification email'));
    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeTruthy());

    const button = screen.getByRole('button', { name: /resend verification email/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls the "back to sign up" callback', () => {
    const onBack = vi.fn();
    render(<CheckEmailScreen email="jane@example.com" next="/" onBackToSignup={onBack} />);
    fireEvent.click(screen.getByText(/wrong email/i));
    expect(onBack).toHaveBeenCalled();
  });
});
