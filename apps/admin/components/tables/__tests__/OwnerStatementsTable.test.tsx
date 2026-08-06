// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OwnerStatementsTable, type OwnerStatementWithOwnerName } from '../OwnerStatementsTable';

afterEach(cleanup);

const STATEMENT: OwnerStatementWithOwnerName = {
  id: 'stmt-1',
  orgId: 'org-1',
  ownerId: 'owner-1',
  ownerName: 'Jane Owner',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  rentCollected: 18500,
  expensesTotal: 1200,
  managementFee: 1850,
  reserveAmount: 0,
  netPayable: 15450,
  amountPaid: 0,
  outstandingBalance: 15450,
  status: 'issued',
  payoutMatchedTransactionId: null,
  pdfDocumentId: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

describe('OwnerStatementsTable', () => {
  it('renders owner name, period, amounts, and status', () => {
    render(<OwnerStatementsTable data={[STATEMENT]} />);
    expect(screen.getByText('Jane Owner')).toBeTruthy();
    expect(screen.getByText('2026-07-01 – 2026-07-31')).toBeTruthy();
    expect(screen.getByText(/^R18.500$/)).toBeTruthy();
    expect(screen.getByText(/^R15.450$/)).toBeTruthy();
    expect(screen.getByText('Issued')).toBeTruthy();
  });

  it('renders the empty state with the custom action when there are no statements', () => {
    render(<OwnerStatementsTable data={[]} emptyAction={<button>Generate statements</button>} />);
    expect(screen.getByText('No owner statements yet')).toBeTruthy();
    expect(screen.getByText('Generate statements')).toBeTruthy();
  });
});
