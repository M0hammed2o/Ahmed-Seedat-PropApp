// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { BankTransaction, RentSchedule } from '@propvault/types';
import { BankTransactionsTable } from '../BankTransactionsTable';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

const UNMATCHED: BankTransaction = {
  id: 'bank-transaction-1',
  bankAccountId: 'bank-account-1',
  transactionDate: '2026-08-01',
  amount: 12500,
  description: 'EFT rent payment',
  reference: 'REF1',
  matchedJournalEntryId: null,
  matchedRentScheduleId: null,
  matchStatus: 'unmatched',
  createdAt: '2026-08-01T00:00:00Z',
};

const CANDIDATE: RentSchedule = {
  id: 'rent-schedule-1',
  orgId: 'org-1',
  leaseId: 'lease-1',
  dueDate: '2026-08-01',
  amount: 12500,
  status: 'pending',
  generatedAt: '2026-08-01T00:00:00Z',
};

describe('BankTransactionsTable', () => {
  it('renders transaction rows with formatted amount and status', () => {
    render(<BankTransactionsTable data={[UNMATCHED]} canPost={false} rentScheduleCandidates={[]} />);
    expect(screen.getByText('EFT rent payment')).toBeTruthy();
    expect(screen.getByText(/^R12.500$/)).toBeTruthy();
    expect(screen.getByText('Unmatched')).toBeTruthy();
  });

  it('shows a Match control with rent-schedule candidates for an unmatched row when canPost', () => {
    render(<BankTransactionsTable data={[UNMATCHED]} canPost rentScheduleCandidates={[CANDIDATE]} />);
    expect(screen.getByText('Match')).toBeTruthy();
  });

  it('shows "No pending rent due to match" when there are no candidates', () => {
    render(<BankTransactionsTable data={[UNMATCHED]} canPost rentScheduleCandidates={[]} />);
    expect(screen.getByText('No pending rent due to match')).toBeTruthy();
  });

  it('hides the actions column entirely when canPost is false', () => {
    render(<BankTransactionsTable data={[UNMATCHED]} canPost={false} rentScheduleCandidates={[CANDIDATE]} />);
    expect(screen.queryByText('Match')).toBeNull();
  });

  it('does not show the Match control for an already-matched transaction', () => {
    render(
      <BankTransactionsTable
        data={[{ ...UNMATCHED, matchStatus: 'matched' }]}
        canPost
        rentScheduleCandidates={[CANDIDATE]}
      />,
    );
    expect(screen.queryByText('Match')).toBeNull();
  });
});
