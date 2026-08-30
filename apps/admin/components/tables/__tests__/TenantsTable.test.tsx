// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TenantsTable } from '../TenantsTable';
import type { TenantWithTenancy } from '@/app/(dashboard)/tenants/page';

afterEach(cleanup);

const TENANT: TenantWithTenancy = {
  id: 'tenant-1',
  orgId: 'org-1',
  userId: null,
  fullName: 'Naledi Khumalo',
  email: 'naledi@example.com',
  phone: '+27 82 555 0134',
  idNumberRef: null,
  status: 'active',
  createdAt: '2026-06-05T00:00:00Z',
  updatedAt: '2026-06-05T00:00:00Z',
  tenancy: {
    leaseId: 'lease-1',
    leaseStatus: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    rentAmount: 12000,
    rentFrequency: 'monthly',
    unitId: 'unit-601',
    unitLabel: 'Unit 601',
    propertyId: 'property-1',
    propertyNickname: 'Musgrave Heights',
  },
  portalStatus: { status: 'not_invited', label: 'Not invited' },
};

// Tenant/occupancy V1 pass -- Problem 2's fix: a tenant row must show property/unit/lease/portal
// context without opening the tenant, matching the exact target layout from the product spec
// ("John Smith / Musgrave Heights · Unit 601 / R12,000/month / Active lease / Portal: Not invited").
describe('TenantsTable', () => {
  it('renders property, unit, rent, lease status, and portal status for a tenant with a current tenancy', () => {
    render(<TenantsTable data={[TENANT]} />);
    expect(screen.getByText('Naledi Khumalo')).toBeTruthy();
    expect(screen.getByText('Musgrave Heights')).toBeTruthy();
    expect(screen.getByText('Unit 601')).toBeTruthy();
    expect(screen.getByText(/R12[,\s]000/)).toBeTruthy();
    expect(screen.getByText('Not invited')).toBeTruthy();
  });

  it('links the property and unit cells to their own pages', () => {
    render(<TenantsTable data={[TENANT]} />);
    const propertyLink = screen.getByRole('link', { name: 'Musgrave Heights' });
    expect(propertyLink.getAttribute('href')).toBe('/properties/property-1');
    const unitLink = screen.getByRole('link', { name: 'Unit 601' });
    expect(unitLink.getAttribute('href')).toBe('/properties/property-1/units/unit-601');
  });

  it('shows a dash and "No lease" for a tenant with no current tenancy, never a fabricated one', () => {
    render(<TenantsTable data={[{ ...TENANT, tenancy: null }]} />);
    expect(screen.getByText('No lease')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the correct portal status label for each state', () => {
    // tenancy: null on the non-"active" rows -- distinct from lease status, which also renders
    // the literal text "Active" and would otherwise collide with the portal-status assertion.
    render(
      <TenantsTable
        data={[
          { ...TENANT, id: 't-active', userId: 'user-1', portalStatus: { status: 'active', label: 'Active' } },
          { ...TENANT, id: 't-pending', tenancy: null, portalStatus: { status: 'pending', label: 'Invitation pending' } },
          { ...TENANT, id: 't-expired', tenancy: null, portalStatus: { status: 'expired', label: 'Invitation expired' } },
        ]}
      />,
    );
    expect(screen.getAllByText('Active')).toHaveLength(2); // lease status + portal status, same row
    expect(screen.getByText('Invitation pending')).toBeTruthy();
    expect(screen.getByText('Invitation expired')).toBeTruthy();
  });

  it('renders the empty state with the custom action when there are no tenants', () => {
    render(<TenantsTable data={[]} emptyAction={<button>+ Add tenant</button>} />);
    expect(screen.getByText('No tenants yet')).toBeTruthy();
    expect(screen.getByText('+ Add tenant')).toBeTruthy();
  });
});
