// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { BankAccount } from '@propvault/types';
import { BankAccountsTable } from '../BankAccountsTable';

afterEach(cleanup);

const ACCOUNT: BankAccount = {
  id: 'bank-account-1',
  orgId: 'org-1',
  accountClass: 'business',
  bankName: 'FNB Business',
  accountNumberRef: null,
  isActive: true,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

describe('BankAccountsTable', () => {
  it('renders bank account rows with class', () => {
    render(<BankAccountsTable data={[ACCOUNT]} />);
    expect(screen.getByText('FNB Business')).toBeTruthy();
    expect(screen.getByText('business')).toBeTruthy();
  });

  it('renders the empty state with the custom action when there are no bank accounts', () => {
    render(<BankAccountsTable data={[]} emptyAction={<button>+ Add bank account</button>} />);
    expect(screen.getByText('No bank accounts yet')).toBeTruthy();
    expect(screen.getByText('+ Add bank account')).toBeTruthy();
  });
});
