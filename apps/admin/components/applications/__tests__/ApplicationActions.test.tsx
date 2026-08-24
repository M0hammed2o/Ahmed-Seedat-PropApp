// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Application } from '@propvault/types';
import { ApplicationActions } from '../ApplicationActions';

// ApplicationActions/DecisionPanel call useRouter() (for .refresh() after each action) -- plain
// RTL rendering has no App Router context mounted, unlike a real Next.js page render, so the
// first test run here failed with "invariant expected app router to be mounted" for every case.
// The first component test in this codebase to render something that calls useRouter directly
// (every earlier form component that needs it -- NewPropertyForm, UnitForm, etc. -- was never
// itself under test, only the presentational Table/Board components were).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

const BASE: Application = {
  id: 'application-1',
  orgId: 'org-1',
  propertyId: 'property-1',
  unitId: 'unit-1',
  applicantName: 'Sipho Nkosi',
  applicantEmail: 'sipho@example.com',
  applicantPhone: null,
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

describe('ApplicationActions', () => {
  it('shows the decision outcome and no action panels once decided', () => {
    render(
      <ApplicationActions
        application={{
          ...BASE,
          status: 'decided',
          decision: 'approved',
          decidedAt: '2026-08-02T00:00:00Z',
        }}
        canAct
      />,
    );
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.queryByText('Decision')).toBeNull();
    expect(screen.queryByText('Withdraw application')).toBeNull();
  });

  it('shows a "Withdrawn" summary and no action panels once withdrawn', () => {
    render(<ApplicationActions application={{ ...BASE, status: 'withdrawn' }} canAct />);
    expect(screen.getByText('Withdrawn')).toBeTruthy();
    expect(screen.queryByText('Decision')).toBeNull();
  });

  it('shows a "Record consent" button and an editable, empty notes field for an actionable caller', () => {
    render(<ApplicationActions application={BASE} canAct />);
    expect(screen.getByText('Record consent')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Notes from reviewing/)).toBeTruthy();
    expect(screen.getByText('Save notes')).toBeTruthy();
  });

  it('shows "No notes yet." instead of an editable field for a read-only caller with no notes', () => {
    render(<ApplicationActions application={BASE} canAct={false} />);
    expect(screen.getByText('No notes yet.')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Notes from reviewing/)).toBeNull();
  });

  it('shows the granted consent timestamp once POPIA consent is recorded', () => {
    render(
      <ApplicationActions
        application={{ ...BASE, popiaConsentAt: '2026-08-01T00:00:00Z' }}
        canAct
      />,
    );
    expect(screen.getByText(/Granted/)).toBeTruthy();
    expect(screen.queryByText('Record consent')).toBeNull();
  });

  it('never renders any screening UI (V1 scope: screening is deferred, not exposed)', () => {
    render(<ApplicationActions application={BASE} canAct />);
    expect(screen.queryByText('Run screening')).toBeNull();
    expect(screen.queryByText('Screening consent')).toBeNull();
  });

  it('hides consent/notes/decision/withdraw action controls for a read-only (viewer/accountant) caller', () => {
    render(<ApplicationActions application={BASE} canAct={false} />);
    expect(screen.queryByText('Record consent')).toBeNull();
    expect(screen.getByText('Not yet granted')).toBeTruthy();
    expect(screen.queryByText('Decision')).toBeNull();
    expect(screen.queryByText('Withdraw application')).toBeNull();
  });
});
