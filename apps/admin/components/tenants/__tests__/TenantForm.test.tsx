// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TenantForm } from '../TenantForm';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockClear();
  refresh.mockClear();
});

const PROPERTIES = [{ id: 'property-1', nickname: 'Musgrave Heights' }];
const UNITS = [{ id: 'unit-601', propertyId: 'property-1', unitLabel: '601', status: 'vacant' as const }];

function mockFetchSequence(responses: { status: number; body: unknown }[]) {
  let call = 0;
  return vi.fn().mockImplementation(async () => {
    const r = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  });
}

// Tenant/occupancy V1 pass. Default option must be "Manage internally only" (privacy-preserving
// default per the product spec), and creating a tenant that way must call POST /api/v1/tenants
// ONLY -- never the invitations endpoint -- matching "creating a tenant must never automatically
// mean contact this tenant."
describe('TenantForm (create mode)', () => {
  beforeEach(() => {
    global.fetch = mockFetchSequence([{ status: 201, body: { tenant: { id: 'new-tenant-1' } } }]);
  });

  it('defaults to "Manage internally only" and does not require email/phone', async () => {
    render(<TenantForm mode="create" orgId="org-1" properties={PROPERTIES} units={UNITS} />);
    const internalRadio = screen.getByRole('radio', { name: /Manage internally only/i });
    expect(internalRadio).toHaveProperty('checked', true);

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Synthetic Test Tenant A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create tenant' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tenants/new-tenant-1'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/tenants',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // Overnight V1 completion pass (WORKLOG.md this date): permanent regression guard for the exact
  // production report -- "Manage internally only" explicitly selected, WITH both an email and a
  // phone number entered, must still send exactly one request (POST /api/v1/tenants) and never
  // reach the invitations endpoint. hasEmail/hasPhone on the invitation panel only ever choose a
  // delivery-channel default for later, explicit, opt-in invites -- they must never themselves
  // trigger an invitation at tenant-creation time.
  it('sends no invitation for "Manage internally only" even when email and phone are both entered', async () => {
    render(<TenantForm mode="create" orgId="org-1" properties={PROPERTIES} units={UNITS} />);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Synthetic Test Tenant A' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'synthetic-a@example.invalid' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+27 82 555 0100' } });
    expect(screen.getByRole('radio', { name: /Manage internally only/i })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('button', { name: 'Create tenant' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tenants/new-tenant-1'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/tenants',
      expect.objectContaining({ method: 'POST' }),
    );
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => String(c[0]).includes('/invitations'))).toBe(false);
  });

  it('blocks submission for "Invite tenant to Proplyst" with no email or phone', async () => {
    render(<TenantForm mode="create" orgId="org-1" properties={PROPERTIES} units={UNITS} />);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Synthetic Test Tenant A' } });
    fireEvent.click(screen.getByRole('radio', { name: /Invite tenant to Proplyst/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create tenant' }));

    expect(await screen.findByText(/Add an email or phone number/i)).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends an invitation only when "Invite tenant to Proplyst" was explicitly chosen', async () => {
    global.fetch = mockFetchSequence([
      { status: 201, body: { tenant: { id: 'new-tenant-2' } } },
      { status: 201, body: { invitationId: 'inv-1', token: 't', shortCode: null, expiresAt: '2026-09-01', acceptUrl: 'x' } },
    ]);
    render(<TenantForm mode="create" orgId="org-1" properties={PROPERTIES} units={UNITS} />);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Synthetic Test Tenant B' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'synthetic-b@example.invalid' } });
    fireEvent.click(screen.getByRole('radio', { name: /Invite tenant to Proplyst/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create tenant' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0]).toBe('/api/v1/tenants');
    expect(calls[1]![0]).toBe('/api/v1/tenants/new-tenant-2/invitations');
    expect(JSON.parse(calls[1]![1].body)).toEqual({ deliveryChannel: 'email', includeShortCode: false });
  });

  it('routes to the lease-creation flow, carrying the new tenant id, when a property and unit were selected', async () => {
    render(<TenantForm mode="create" orgId="org-1" properties={PROPERTIES} units={UNITS} />);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Synthetic Test Tenant A' } });
    fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'property-1' } });
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'unit-601' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create tenant' }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/properties/property-1/units/unit-601/leases/new?tenantId=new-tenant-1'),
    );
  });

  it('routes to the plain tenant page when no property/unit was selected', async () => {
    render(<TenantForm mode="create" orgId="org-1" properties={PROPERTIES} units={UNITS} />);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Synthetic Test Tenant A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create tenant' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tenants/new-tenant-1'));
  });
});

describe('TenantForm (edit mode)', () => {
  it('does not render the tenancy-location or tenant-access sections', () => {
    render(
      <TenantForm
        mode="edit"
        orgId="org-1"
        tenant={{
          id: 'tenant-1',
          orgId: 'org-1',
          userId: null,
          fullName: 'Naledi Khumalo',
          email: null,
          phone: null,
          idNumberRef: null,
          status: 'active',
          emergencyContactName: null,
          emergencyContactPhone: null,
          emergencyContactRelationship: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        }}
      />,
    );
    expect(screen.queryByText('Tenancy location')).toBeNull();
    expect(screen.queryByText('Tenant access')).toBeNull();
    expect(screen.queryByRole('radio', { name: /Manage internally only/i })).toBeNull();
  });
});
