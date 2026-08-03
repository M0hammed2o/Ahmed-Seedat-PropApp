// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TenantInvitation } from '@propvault/types';
import { TenantInvitationPanel } from '../TenantInvitationPanel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const baseInvitation: TenantInvitation = {
  id: 'invite-1',
  orgId: 'org-1',
  tenantId: 'tenant-1',
  deliveryChannel: 'email',
  destinationHint: 'j***@example.com',
  expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  acceptedAt: null,
  acceptedByUserId: null,
  revokedAt: null,
  createdByUserId: 'staff-1',
  failedAttemptCount: 0,
  resendCount: 0,
  createdAt: new Date().toISOString(),
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TenantInvitationPanel', () => {
  it('shows the send form (not a pending-invite row) when there is no active invitation', () => {
    render(<TenantInvitationPanel tenantId="tenant-1" hasEmail hasPhone={false} invitations={[]} />);
    expect(screen.getByText('Send invitation')).toBeTruthy();
  });

  it('shows the pending invitation + Revoke button instead of the send form when one is already active', () => {
    render(<TenantInvitationPanel tenantId="tenant-1" hasEmail hasPhone={false} invitations={[baseInvitation]} />);
    expect(screen.queryByText('Send invitation')).toBeNull();
    expect(screen.getByText('Revoke')).toBeTruthy();
    expect(screen.getByText(/Pending via email/)).toBeTruthy();
  });

  it('treats an accepted invitation as no-longer-active -- shows the send form again, not a stale pending row', () => {
    const accepted = { ...baseInvitation, acceptedAt: new Date().toISOString(), acceptedByUserId: 'tenant-user-1' };
    render(<TenantInvitationPanel tenantId="tenant-1" hasEmail hasPhone={false} invitations={[accepted]} />);
    expect(screen.getByText('Send invitation')).toBeTruthy();
    expect(screen.getByText('Accepted')).toBeTruthy(); // in the history list
  });

  it('shows the one-time token/code panel after a successful send, with a "won\'t be shown again" warning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          invitationId: 'invite-2',
          token: 'raw-token-value',
          shortCode: 'ABCD1234',
          expiresAt: new Date().toISOString(),
          acceptUrl: 'http://localhost:3000/activate?token=raw-token-value',
        }),
      }),
    );

    render(<TenantInvitationPanel tenantId="tenant-1" hasEmail={false} hasPhone={false} invitations={[]} />);
    fireEvent.click(screen.getByText('Send invitation'));

    await waitFor(() => expect(screen.getByText(/won't be shown again/)).toBeTruthy());
    expect(screen.getByDisplayValue('http://localhost:3000/activate?token=raw-token-value')).toBeTruthy();
    expect(screen.getByDisplayValue('ABCD1234')).toBeTruthy();
  });

  it('surfaces a real API error (e.g. no destination on file) instead of silently failing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { code: 'no_destination', message: 'This tenant has no email address on file.' } }),
      }),
    );

    render(<TenantInvitationPanel tenantId="tenant-1" hasEmail={false} hasPhone={false} invitations={[]} />);
    fireEvent.click(screen.getByText('Send invitation'));

    await waitFor(() => expect(screen.getByText('This tenant has no email address on file.')).toBeTruthy());
  });
});
