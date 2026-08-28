// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Expense } from '@propvault/types';
import { ExpensesTable } from '../ExpensesTable';

afterEach(cleanup);

const EXPENSE: Expense = {
  id: 'expense-1',
  orgId: 'org-1',
  propertyId: 'property-1',
  unitId: null,
  vendorId: null,
  category: 'Plumbing repair',
  amount: 1850,
  status: 'pending',
  documentId: null,
  journalEntryId: null,
  referenceNumber: null,
  invoiceDate: null,
  notes: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

describe('ExpensesTable', () => {
  it('renders expense rows with category, formatted amount, and status', () => {
    render(<ExpensesTable data={[EXPENSE]} />);
    expect(screen.getByText('Plumbing repair')).toBeTruthy();
    expect(screen.getByText(/^R1.850$/)).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('renders the empty state with the custom action when there are no expenses', () => {
    render(<ExpensesTable data={[]} emptyAction={<button>+ Add expense</button>} />);
    expect(screen.getByText('No expenses yet')).toBeTruthy();
    expect(screen.getByText('+ Add expense')).toBeTruthy();
  });
});
