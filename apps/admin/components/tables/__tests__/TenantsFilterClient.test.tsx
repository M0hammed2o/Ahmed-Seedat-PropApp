// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TenantsFilterClient } from '../TenantsFilterClient';
import type { TenantWithTenancy } from '@/app/(dashboard)/tenants/page';

afterEach(cleanup);

function tenant(overrides: Partial<TenantWithTenancy>): TenantWithTenancy {
  return {
    id: overrides.id ?? 'tenant-x',
    orgId: 'org-1',
    userId: null,
    fullName: overrides.fullName ?? 'Unnamed',
    email: null,
    phone: null,
    idNumberRef: null,
    status: 'active',
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelationship: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    tenancy: null,
    portalStatus: { status: 'not_invited', label: 'Not invited' },
    ...overrides,
  };
}

const JOHN = tenant({
  id: 't-john',
  fullName: 'John Smith',
  tenancy: {
    leaseId: 'l-1',
    leaseStatus: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    rentAmount: 12000,
    rentFrequency: 'monthly',
    unitId: 'u-601',
    unitLabel: 'Unit 601',
    propertyId: 'p-musgrave',
    propertyNickname: 'Musgrave Heights',
  },
  portalStatus: { status: 'not_invited', label: 'Not invited' },
});
const SARAH = tenant({
  id: 't-sarah',
  fullName: 'Sarah Naidoo',
  tenancy: {
    leaseId: 'l-2',
    leaseStatus: 'active',
    startDate: '2026-02-01',
    endDate: '2026-12-31',
    rentAmount: 18500,
    rentFrequency: 'monthly',
    unitId: 'u-4b',
    unitLabel: 'Unit 4B',
    propertyId: 'p-umhlanga',
    propertyNickname: 'Umhlanga Apartments',
  },
  portalStatus: { status: 'active', label: 'Active' },
});

describe('TenantsFilterClient', () => {
  it('filters by property', () => {
    render(<TenantsFilterClient tenants={[JOHN, SARAH]} />);
    expect(screen.getByText('John Smith')).toBeTruthy();
    expect(screen.getByText('Sarah Naidoo')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter by property'), {
      target: { value: 'p-musgrave' },
    });
    expect(screen.getByText('John Smith')).toBeTruthy();
    expect(screen.queryByText('Sarah Naidoo')).toBeNull();
  });

  it('filters by portal status', () => {
    render(<TenantsFilterClient tenants={[JOHN, SARAH]} />);
    fireEvent.change(screen.getByLabelText('Filter by portal status'), {
      target: { value: 'active' },
    });
    expect(screen.queryByText('John Smith')).toBeNull();
    expect(screen.getByText('Sarah Naidoo')).toBeTruthy();
  });

  it('combines text search with the dropdown filters', () => {
    render(<TenantsFilterClient tenants={[JOHN, SARAH]} />);
    fireEvent.change(screen.getByPlaceholderText(/Search tenants/i), {
      target: { value: 'Sarah' },
    });
    expect(screen.queryByText('John Smith')).toBeNull();
    expect(screen.getByText('Sarah Naidoo')).toBeTruthy();
  });
});
