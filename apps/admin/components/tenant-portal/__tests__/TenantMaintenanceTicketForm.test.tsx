// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TenantMaintenanceTicketForm } from '../TenantMaintenanceTicketForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

describe('TenantMaintenanceTicketForm', () => {
  it('renders the summary, description, and priority fields', () => {
    render(<TenantMaintenanceTicketForm />);
    expect(screen.getByText("What's wrong?")).toBeTruthy();
    expect(screen.getByText('Details (optional)')).toBeTruthy();
    expect(screen.getByText('Priority')).toBeTruthy();
    expect(screen.getByText('Submit request')).toBeTruthy();
  });

  it('defaults priority to medium', () => {
    render(<TenantMaintenanceTicketForm />);
    const select = screen.getByDisplayValue('Medium') as HTMLSelectElement;
    expect(select.value).toBe('medium');
  });
});
