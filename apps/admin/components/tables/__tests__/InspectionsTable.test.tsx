// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Inspection } from '@propvault/types';
import { InspectionsTable } from '../InspectionsTable';

afterEach(cleanup);

const INSPECTION: Inspection = {
  id: 'inspection-1',
  orgId: 'org-1',
  propertyId: 'property-1',
  unitId: 'unit-1',
  leaseId: null,
  inspectionType: 'move_in',
  scheduledAt: '2026-08-05T09:00:00Z',
  status: 'scheduled',
  landlordSignedAt: null,
  tenantSignedAt: null,
  tenantRefusalReason: null,
  completedAt: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

describe('InspectionsTable', () => {
  it('renders inspection rows with type and status', () => {
    render(<InspectionsTable data={[INSPECTION]} />);
    expect(screen.getByText('Move-in')).toBeTruthy();
    // "Scheduled" appears twice: the column header (date) and the status badge value -- both
    // legitimate, not a bug, so assert on count rather than a single ambiguous getByText.
    expect(screen.getAllByText('Scheduled').length).toBe(2);
  });

  it('renders the empty state with the custom action when there are no inspections', () => {
    render(<InspectionsTable data={[]} emptyAction={<button>+ Schedule inspection</button>} />);
    expect(screen.getByText('No inspections yet')).toBeTruthy();
    expect(screen.getByText('+ Schedule inspection')).toBeTruthy();
  });
});
