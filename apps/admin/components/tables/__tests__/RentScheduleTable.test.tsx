// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { RentSchedule } from '@propvault/types';
import { RentScheduleTable } from '../RentScheduleTable';

afterEach(cleanup);

const PENDING: RentSchedule = {
  id: 'rent-schedule-1',
  orgId: 'org-1',
  leaseId: 'lease-1',
  dueDate: '2026-09-01',
  amount: 12500,
  status: 'pending',
  generatedAt: '2026-08-01T00:00:00Z',
};

describe('RentScheduleTable', () => {
  it('renders rows with formatted amount and status', () => {
    render(<RentScheduleTable data={[PENDING]} canPost={false} onChanged={() => {}} />);
    expect(screen.getByText('2026-09-01')).toBeTruthy();
    expect(screen.getByText(/^R12.500$/)).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('shows the Issue invoice action for a pending row when canPost is true', () => {
    render(<RentScheduleTable data={[PENDING]} canPost onChanged={() => {}} />);
    expect(screen.getByText('Issue invoice')).toBeTruthy();
  });

  it('hides the action column entirely when canPost is false', () => {
    render(<RentScheduleTable data={[PENDING]} canPost={false} onChanged={() => {}} />);
    expect(screen.queryByText('Issue invoice')).toBeNull();
  });

  it('does not show Issue invoice for a non-pending row even when canPost is true', () => {
    render(
      <RentScheduleTable
        data={[{ ...PENDING, status: 'invoiced' }]}
        canPost
        onChanged={() => {}}
      />,
    );
    expect(screen.queryByText('Issue invoice')).toBeNull();
  });
});
