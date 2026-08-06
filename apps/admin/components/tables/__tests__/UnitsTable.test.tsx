// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { UnitsTable, type UnitRow } from '../UnitsTable';

afterEach(cleanup);

const UNIT: UnitRow = {
  id: 'unit-1',
  propertyId: 'property-1',
  orgId: 'org-1',
  unitLabel: 'Unit 4B',
  bedrooms: 2,
  bathrooms: 1,
  sizeSqm: 65,
  marketRent: 12500,
  status: 'occupied',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  propertyNickname: 'Sea Point Apartment',
};

describe('UnitsTable', () => {
  it('renders unit rows with status and formatted rent', () => {
    render(<UnitsTable data={[UNIT]} />);
    expect(screen.getByText('Unit 4B')).toBeTruthy();
    expect(screen.getByText('Occupied')).toBeTruthy();
    // en-ZA groups thousands with a (non-breaking) space, not a comma -- match loosely rather
    // than hardcode the exact whitespace character Node's ICU data produces.
    expect(screen.getByText(/^R12.500$/)).toBeTruthy();
  });

  it('omits the property column unless showProperty is set', () => {
    render(<UnitsTable data={[UNIT]} />);
    expect(screen.queryByText('Sea Point Apartment')).toBeNull();
  });

  it('shows the property column when showProperty is set', () => {
    render(<UnitsTable data={[UNIT]} showProperty />);
    expect(screen.getByText('Sea Point Apartment')).toBeTruthy();
  });

  it('renders the empty state with the custom message and action when there are no units', () => {
    render(
      <UnitsTable
        data={[]}
        emptyMessage="No units yet"
        emptyAction={<button>+ Add unit</button>}
      />,
    );
    expect(screen.getByText('No units yet')).toBeTruthy();
    expect(screen.getByText('+ Add unit')).toBeTruthy();
  });
});
