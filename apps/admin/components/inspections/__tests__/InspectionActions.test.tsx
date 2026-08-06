// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Inspection, InspectionItem } from '@propvault/types';
import { InspectionActions } from '../InspectionActions';

// Same next/navigation useRouter mock needed as ApplicationActions.test.tsx -- plain RTL
// rendering has no App Router context mounted.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

const BASE: Inspection = {
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

const ITEM: InspectionItem = {
  id: 'item-1',
  inspectionId: 'inspection-1',
  room: 'Kitchen',
  itemDescription: 'Cabinets',
  conditionRating: 'good',
  notes: null,
  createdAt: '2026-08-01T00:00:00Z',
};

describe('InspectionActions', () => {
  it('shows the completed summary and no signature panel once completed', () => {
    render(
      <InspectionActions
        inspection={{ ...BASE, status: 'completed', completedAt: '2026-08-05T10:00:00Z' }}
        items={[]}
        canAct
      />,
    );
    expect(screen.getByText(/Completed/)).toBeTruthy();
    expect(screen.queryByText('Signatures')).toBeNull();
  });

  it('renders recorded items and the empty-items message', () => {
    render(<InspectionActions inspection={BASE} items={[ITEM]} canAct />);
    expect(screen.getByText('Kitchen')).toBeTruthy();
    expect(screen.getByText(/Cabinets/)).toBeTruthy();

    cleanup();
    render(<InspectionActions inspection={BASE} items={[]} canAct />);
    expect(screen.getByText('No items recorded yet.')).toBeTruthy();
  });

  it('disables completion until both signatures or a landlord signature plus refusal exist', () => {
    render(<InspectionActions inspection={BASE} items={[]} canAct />);
    const completeButton = screen.getByText('Complete inspection') as HTMLButtonElement;
    expect(completeButton.disabled).toBe(true);
  });

  it('enables completion once both signatures are present', () => {
    render(
      <InspectionActions
        inspection={{
          ...BASE,
          landlordSignedAt: '2026-08-05T09:00:00Z',
          tenantSignedAt: '2026-08-05T09:05:00Z',
        }}
        items={[]}
        canAct
      />,
    );
    const completeButton = screen.getByText('Complete inspection') as HTMLButtonElement;
    expect(completeButton.disabled).toBe(false);
  });

  it('hides sign/complete controls for a read-only caller', () => {
    render(<InspectionActions inspection={BASE} items={[]} canAct={false} />);
    expect(screen.queryByText('Complete inspection')).toBeNull();
    expect(screen.getAllByText('Not yet signed').length).toBe(2);
  });
});
