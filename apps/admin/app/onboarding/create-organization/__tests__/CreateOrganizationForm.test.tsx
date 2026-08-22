// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CreateOrganizationForm } from '../CreateOrganizationForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Part D fallback-route polish (this date): CreateOrganizationForm remains the linked-owner/
// tenant explanatory fallback, not the primary self-service path (that's now
// /onboarding/choose-plan) -- only its labels and disabled-CTA state changed.
describe('CreateOrganizationForm', () => {
  it('disables Create organization until a legal name is entered', () => {
    global.fetch = vi.fn();
    render(<CreateOrganizationForm />);
    const submitButton = screen.getByText('Create organization').closest('button')!;
    expect(submitButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('e.g. Seedat Property Management'), {
      target: { value: 'Seedat Property Management' },
    });
    expect(submitButton.disabled).toBe(false);
  });

  it('uses short, untruncated organization-type option labels', () => {
    render(<CreateOrganizationForm />);
    expect(screen.getByText('Owner-managed — my own properties')).toBeTruthy();
    expect(screen.getByText('Agency — properties for other owners')).toBeTruthy();
  });
});
