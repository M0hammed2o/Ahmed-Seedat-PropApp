// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LeaseActions } from '../LeaseActions';

// Same useRouter mock as ApplicationActions.test.tsx -- LeaseActions calls router.refresh() after
// every action.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tenants: [] }),
    }),
  );
});

describe('LeaseActions', () => {
  it('renders nothing for a read-only caller, regardless of lease status', () => {
    const { container } = render(
      <LeaseActions
        leaseId="lease-1"
        orgId="org-1"
        status="draft"
        hasTenant={false}
        canEdit={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the tenant-assign panel and a disabled Activate button for a draft lease with no tenant', () => {
    render(
      <LeaseActions leaseId="lease-1" orgId="org-1" status="draft" hasTenant={false} canEdit />,
    );
    expect(screen.getByText('Assign tenant')).toBeTruthy();
    const activateButton = screen.getByRole('button', {
      name: 'Activate lease',
    }) as HTMLButtonElement;
    expect(activateButton.disabled).toBe(true);
    expect(
      screen.getByText('Assign a tenant above before this lease can be activated.'),
    ).toBeTruthy();
  });

  it('hides the tenant-assign panel and enables Activate for a draft lease that already has a tenant', () => {
    render(<LeaseActions leaseId="lease-1" orgId="org-1" status="draft" hasTenant canEdit />);
    expect(screen.queryByText('Assign tenant')).toBeNull();
    const activateButton = screen.getByRole('button', {
      name: 'Activate lease',
    }) as HTMLButtonElement;
    expect(activateButton.disabled).toBe(false);
  });

  it('shows "Mark expired" and "Terminate" for an active lease, never the tenant-assign panel or Activate', () => {
    render(<LeaseActions leaseId="lease-1" orgId="org-1" status="active" hasTenant canEdit />);
    expect(screen.getByText('Mark expired')).toBeTruthy();
    expect(screen.getByText('Terminate')).toBeTruthy();
    expect(screen.queryByText('Activate lease')).toBeNull();
    expect(screen.queryByText('Assign tenant')).toBeNull();
  });

  it('renders nothing for an already-ended lease (expired/terminated) -- no transitions left', () => {
    const { container } = render(
      <LeaseActions leaseId="lease-1" orgId="org-1" status="terminated" hasTenant canEdit />,
    );
    expect(container.firstChild).toBeNull();
  });
});
