// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizationActionsPanel } from '../OrganizationActionsPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OrganizationActionsPanel', () => {
  it('hides status actions and plan/credit controls for a role below support_admin', () => {
    render(
      <OrganizationActionsPanel orgId="org-1" legalName="Acme" status="active" currentUserRole="read_only_admin" />,
    );
    expect(screen.queryByText('Activate')).toBeNull();
    expect(screen.queryByText('Change plan')).toBeNull();
  });

  it('shows status actions for support_admin but not plan/credit controls', () => {
    render(
      <OrganizationActionsPanel orgId="org-1" legalName="Acme" status="active" currentUserRole="support_admin" />,
    );
    expect(screen.getByText('Suspend')).toBeTruthy();
    expect(screen.queryByText('Change plan')).toBeNull();
    expect(screen.queryByText('+ Issue credit')).toBeNull();
  });

  it('shows plan-change and credit controls for super_admin', () => {
    render(
      <OrganizationActionsPanel orgId="org-1" legalName="Acme" status="active" currentUserRole="super_admin" />,
    );
    expect(screen.getByText('Change plan')).toBeTruthy();
    expect(screen.getByText('+ Issue credit')).toBeTruthy();
  });

  it('fetches and renders plan options when "Change plan" is opened', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ plans: [{ id: 'plan-1', name: 'Growth' }] }),
      }),
    );

    render(
      <OrganizationActionsPanel orgId="org-1" legalName="Acme" status="active" currentUserRole="super_admin" />,
    );
    fireEvent.click(screen.getByText('Change plan'));

    await waitFor(() => expect(screen.getByText('Growth')).toBeTruthy());
    expect(screen.getByText('Discount % (optional)')).toBeTruthy();
  });
});
