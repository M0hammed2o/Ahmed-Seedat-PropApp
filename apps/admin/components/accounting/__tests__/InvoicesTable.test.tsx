// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { InvoicesTable, type InvoiceRow } from '../InvoicesTable';

// P0 correction pass (WORKLOG.md this date): the row Actions menu's state-dependent visibility --
// Record payment must appear for an issued invoice with an outstanding balance and disappear for
// Draft/Paid/Void, matching the approved rules exactly. <details>/<summary> content stays in the
// DOM regardless of the open attribute, so plain text queries see menu items without simulating a
// click to open the dropdown.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

function invoice(overrides: Partial<InvoiceRow>): InvoiceRow {
  return {
    id: 'invoice-1',
    invoiceNumber: 'INV-000001',
    tenantId: 'tenant-1',
    tenantName: 'Naledi Khumalo',
    propertyId: 'property-1',
    propertyNickname: 'Sea Point Apartment',
    unitId: 'unit-1',
    unitLabel: 'Unit 1',
    description: 'September 2026 Rent',
    period: '2026-09-01',
    issuedAt: '2026-08-25T00:00:00Z',
    amount: 12500,
    paid: 0,
    balance: 12500,
    displayStatus: 'Issued',
    emailedAt: null,
    voidedAt: null,
    source: 'rent_schedule',
    ...overrides,
  };
}

describe('InvoicesTable actions menu', () => {
  it('a Draft invoice offers View, Edit, Issue, and Void -- never Record payment or Send', () => {
    render(<InvoicesTable data={[invoice({ displayStatus: 'Draft', paid: 0, balance: 12500 })]} canSend />);
    expect(screen.getByText('Edit invoice')).toBeTruthy();
    expect(screen.getByText('Issue invoice')).toBeTruthy();
    expect(screen.getByText('Void invoice')).toBeTruthy();
    expect(screen.queryByText('Record payment')).toBeNull();
    expect(screen.queryByText('Send invoice')).toBeNull();
  });

  it('an Issued invoice with an outstanding balance offers Record payment, Send, View payments, Download PDF, and Void (zero active payments)', () => {
    render(<InvoicesTable data={[invoice({ displayStatus: 'Issued', paid: 0, balance: 12500 })]} canSend />);
    expect(screen.getByText('Record payment')).toBeTruthy();
    expect(screen.getByText('Send invoice')).toBeTruthy();
    expect(screen.getByText('View payments')).toBeTruthy();
    expect(screen.getByText('Download PDF')).toBeTruthy();
    expect(screen.getByText('Void invoice')).toBeTruthy();
    expect(screen.queryByText('Edit invoice')).toBeNull();
    expect(screen.queryByText('Issue invoice')).toBeNull();
  });

  it('a Partially paid invoice (balance > 0, some paid) hides Void -- active payments exist', () => {
    render(<InvoicesTable data={[invoice({ displayStatus: 'Partially paid', paid: 8000, balance: 4500 })]} canSend />);
    expect(screen.getByText('Record payment')).toBeTruthy();
    expect(screen.queryByText('Void invoice')).toBeNull();
  });

  it('a Paid invoice hides Record payment and Void, but still offers View payments, Download PDF, and Send if not yet emailed', () => {
    render(<InvoicesTable data={[invoice({ displayStatus: 'Paid', paid: 12500, balance: 0, emailedAt: null })]} canSend />);
    expect(screen.queryByText('Record payment')).toBeNull();
    expect(screen.queryByText('Void invoice')).toBeNull();
    expect(screen.getByText('View payments')).toBeTruthy();
    expect(screen.getByText('Download PDF')).toBeTruthy();
    expect(screen.getByText('Send invoice')).toBeTruthy();
  });

  it('a Paid invoice that has already been emailed does not offer Send again', () => {
    render(
      <InvoicesTable
        data={[invoice({ displayStatus: 'Paid', paid: 12500, balance: 0, emailedAt: '2026-08-26T00:00:00Z' })]}
        canSend
      />,
    );
    expect(screen.queryByText('Send invoice')).toBeNull();
  });

  it('a Void invoice offers only View payments and Download PDF -- never Send, Record payment, or Void again', () => {
    render(
      <InvoicesTable
        data={[invoice({ displayStatus: 'Void', paid: 0, balance: 0, voidedAt: '2026-08-27T00:00:00Z' })]}
        canSend
      />,
    );
    expect(screen.getByText('View payments')).toBeTruthy();
    expect(screen.getByText('Download PDF')).toBeTruthy();
    expect(screen.queryByText('Send invoice')).toBeNull();
    expect(screen.queryByText('Record payment')).toBeNull();
    expect(screen.queryByText('Void invoice')).toBeNull();
  });

  it('a read-only caller (canSend=false, agent/viewer) sees only View -- no write actions at all', () => {
    render(<InvoicesTable data={[invoice({ displayStatus: 'Issued', paid: 0, balance: 12500 })]} canSend={false} />);
    expect(screen.getByText('View invoice')).toBeTruthy();
    expect(screen.queryByText('Record payment')).toBeNull();
    expect(screen.queryByText('Send invoice')).toBeNull();
    expect(screen.queryByText('Void invoice')).toBeNull();
    expect(screen.queryByText('Edit invoice')).toBeNull();
    expect(screen.queryByText('Issue invoice')).toBeNull();
    // Read-only visibility is still granted regardless of write permission.
    expect(screen.getByText('View payments')).toBeTruthy();
    expect(screen.getByText('Download PDF')).toBeTruthy();
  });
});
