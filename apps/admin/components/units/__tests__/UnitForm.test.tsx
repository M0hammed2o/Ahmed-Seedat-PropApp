// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Unit } from '@propvault/types';
import { UnitForm } from '../UnitForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

const BASE_UNIT: Unit = {
  id: 'unit-1',
  propertyId: 'property-1',
  orgId: 'org-1',
  unitLabel: 'Unit 1',
  bedrooms: 2,
  bathrooms: 1,
  sizeSqm: 60,
  marketRent: 10000,
  status: 'vacant',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

// Stage 7: occupied/vacant is derived from lease activity (sync_unit_status_from_lease_trigger,
// migration 20260101000079) and the API now rejects a direct PATCH to 'occupied' -- this form must
// never offer it as a selectable option, and must show an occupied unit's status as read-only
// rather than a dropdown that would just get rejected on submit.
describe('UnitForm status field', () => {
  it('never offers "occupied" as a selectable option, for a new unit', () => {
    render(<UnitForm mode="create" propertyId="property-1" />);
    const select = screen.getByDisplayValue('Vacant') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(['vacant', 'maintenance']);
  });

  it('shows a maintenance unit as an editable select, still without "occupied" as an option', () => {
    render(
      <UnitForm
        mode="edit"
        propertyId="property-1"
        unit={{ ...BASE_UNIT, status: 'maintenance' }}
      />,
    );
    const select = screen.getByDisplayValue('Maintenance') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(['vacant', 'maintenance']);
  });

  it('shows an occupied unit as read-only text, not a select the user could change', () => {
    render(
      <UnitForm mode="edit" propertyId="property-1" unit={{ ...BASE_UNIT, status: 'occupied' }} />,
    );
    expect(screen.getByText(/derived from this unit's active lease/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
