// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { MaintenanceTicket } from '@propvault/types';
import { MaintenanceTable } from '../MaintenanceTable';

afterEach(cleanup);

const TICKET: MaintenanceTicket = {
  id: 'ticket-1',
  orgId: 'org-1',
  propertyId: 'property-1',
  unitId: null,
  leaseId: null,
  tenantId: null,
  submittedByUserId: 'user-1',
  submittedByTenantId: null,
  summary: 'Leaking kitchen tap',
  description: null,
  priority: 'high',
  status: 'in_progress',
  assignedVendorId: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  resolvedAt: null,
};

describe('MaintenanceTable', () => {
  it('renders ticket rows with priority and status', () => {
    render(<MaintenanceTable data={[TICKET]} />);
    expect(screen.getByText('Leaking kitchen tap')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  it('renders the empty state with the custom action when there are no tickets', () => {
    render(<MaintenanceTable data={[]} emptyAction={<button>+ Report issue</button>} />);
    expect(screen.getByText('No maintenance tickets yet')).toBeTruthy();
    expect(screen.getByText('+ Report issue')).toBeTruthy();
  });
});
