// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Application } from '@propvault/types';
import { ApplicationsTable } from '../ApplicationsTable';

afterEach(cleanup);

const APPLICATION: Application = {
  id: 'application-1',
  orgId: 'org-1',
  propertyId: 'property-1',
  unitId: 'unit-1',
  applicantName: 'Sipho Nkosi',
  applicantEmail: 'sipho@example.com',
  applicantPhone: '+27 84 555 0177',
  popiaConsentAt: null,
  screeningConsentAt: null,
  screeningStatus: 'not_started',
  status: 'submitted',
  decision: null,
  decisionReason: null,
  decidedBy: null,
  decidedAt: null,
  notes: null,
  dateOfBirth: null,
  currentAddress: null,
  employmentStatus: null,
  employerName: null,
  monthlyIncome: null,
  householdSize: null,
  applicantNotes: null,
  submittedAt: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

describe('ApplicationsTable', () => {
  it('renders application rows with the "New" status label for a freshly submitted application', () => {
    render(<ApplicationsTable data={[APPLICATION]} />);
    expect(screen.getByText('Sipho Nkosi')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText('sipho@example.com')).toBeTruthy();
  });

  it('shows "Reviewing" once status has advanced', () => {
    render(<ApplicationsTable data={[{ ...APPLICATION, status: 'reviewing' }]} />);
    expect(screen.getByText('Reviewing')).toBeTruthy();
  });

  it('shows the actual decision ("Approved"), not the generic "Decided" label, for a decided row', () => {
    render(
      <ApplicationsTable data={[{ ...APPLICATION, status: 'decided', decision: 'approved' }]} />,
    );
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.queryByText('Decided')).toBeNull();
  });

  it('shows "Withdrawn" for a withdrawn application', () => {
    render(<ApplicationsTable data={[{ ...APPLICATION, status: 'withdrawn' }]} />);
    expect(screen.getByText('Withdrawn')).toBeTruthy();
  });

  it('renders the empty state with the custom action when there are no applications', () => {
    render(<ApplicationsTable data={[]} emptyAction={<button>+ New application</button>} />);
    expect(screen.getByText('No applications yet')).toBeTruthy();
    expect(screen.getByText('+ New application')).toBeTruthy();
  });
});
