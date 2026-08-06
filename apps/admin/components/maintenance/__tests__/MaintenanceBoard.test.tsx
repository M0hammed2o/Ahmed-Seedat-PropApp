// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { MaintenanceTicket } from '@propvault/types';
import { MaintenanceBoard } from '../MaintenanceBoard';

afterEach(cleanup);

function ticket(overrides: Partial<MaintenanceTicket>): MaintenanceTicket {
  return {
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
    priority: 'medium',
    status: 'to_do',
    assignedVendorId: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    resolvedAt: null,
    ...overrides,
  };
}

describe('MaintenanceBoard', () => {
  it('renders the empty state when there are no tickets', () => {
    render(<MaintenanceBoard tickets={[]} />);
    expect(screen.getByText('No maintenance tickets yet')).toBeTruthy();
  });

  it('groups tickets into their status column', () => {
    render(
      <MaintenanceBoard
        tickets={[
          ticket({ id: 'a', summary: 'To do ticket', status: 'to_do' }),
          ticket({ id: 'b', summary: 'Completed ticket', status: 'completed' }),
        ]}
      />,
    );
    expect(screen.getByText('To do ticket')).toBeTruthy();
    expect(screen.getByText('Completed ticket')).toBeTruthy();
    // 4 status columns always render, each with its own count badge -- 2 populated, 2 empty ("None").
    expect(screen.getAllByText('None').length).toBe(2);
  });
});
