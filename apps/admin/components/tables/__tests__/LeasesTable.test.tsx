// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LeasesTable, type LeaseRow } from '../LeasesTable';

afterEach(cleanup);

const LEASE: LeaseRow = {
  id: 'lease-1',
  orgId: 'org-1',
  unitId: 'unit-1',
  startDate: '2026-02-01',
  endDate: null,
  rentAmount: 12500,
  rentFrequency: 'monthly',
  depositAmount: 12500,
  status: 'active',
  source: 'manual',
  sourceDocumentId: null,
  sourceApplicationId: null,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
  unitLabel: 'Unit 1',
  propertyId: 'property-1',
  propertyNickname: 'Sea Point Apartment',
};

describe('LeasesTable', () => {
  it('renders lease rows with an open-ended end date and status', () => {
    render(<LeasesTable data={[LEASE]} />);
    expect(screen.getByText('2026-02-01 – open-ended')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('omits the unit column unless showUnit is set', () => {
    render(<LeasesTable data={[LEASE]} />);
    expect(screen.queryByText(/Sea Point Apartment/)).toBeNull();
  });

  it('shows the unit/property column when showUnit is set', () => {
    render(<LeasesTable data={[LEASE]} showUnit />);
    expect(screen.getByText('Sea Point Apartment — Unit 1')).toBeTruthy();
  });

  it('renders the empty state with the custom message and action when there are no leases', () => {
    render(
      <LeasesTable
        data={[]}
        emptyMessage="No leases yet"
        emptyAction={<button>+ Add lease</button>}
      />,
    );
    expect(screen.getByText('No leases yet')).toBeTruthy();
    expect(screen.getByText('+ Add lease')).toBeTruthy();
  });
});
