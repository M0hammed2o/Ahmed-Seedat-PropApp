import { describe, expect, it } from 'vitest';
import { computeInvoiceDisplayStatus } from '../invoicing';

describe('computeInvoiceDisplayStatus', () => {
  it('a draft invoice is always Draft, regardless of balance', () => {
    expect(
      computeInvoiceDisplayStatus({ invoiceStatus: 'draft', balance: 500, paid: 0, scheduleStatus: 'pending' }),
    ).toBe('Draft');
  });

  it('a fully paid invoice (balance <= 0) is Paid, even if the schedule says overdue', () => {
    expect(
      computeInvoiceDisplayStatus({ invoiceStatus: 'issued', balance: 0, paid: 1000, scheduleStatus: 'overdue' }),
    ).toBe('Paid');
  });

  it('an issued invoice with an outstanding balance and an overdue schedule is Overdue', () => {
    expect(
      computeInvoiceDisplayStatus({ invoiceStatus: 'issued', balance: 400, paid: 0, scheduleStatus: 'overdue' }),
    ).toBe('Overdue');
  });

  it('an issued invoice with some payment but not overdue is Partially paid', () => {
    expect(
      computeInvoiceDisplayStatus({ invoiceStatus: 'issued', balance: 400, paid: 600, scheduleStatus: 'partial' }),
    ).toBe('Partially paid');
  });

  it('an issued invoice with no payment and not overdue is Issued', () => {
    expect(
      computeInvoiceDisplayStatus({ invoiceStatus: 'issued', balance: 1000, paid: 0, scheduleStatus: 'invoiced' }),
    ).toBe('Issued');
  });

  it('a voided invoice is Void regardless of balance, paid, or schedule status -- checked first', () => {
    expect(
      computeInvoiceDisplayStatus({
        invoiceStatus: 'issued',
        balance: 1000,
        paid: 0,
        scheduleStatus: 'overdue',
        voidedAt: '2026-08-01T00:00:00Z',
      }),
    ).toBe('Void');
  });

  it('a null voidedAt does not force Void -- normal status computation proceeds', () => {
    expect(
      computeInvoiceDisplayStatus({
        invoiceStatus: 'issued',
        balance: 0,
        paid: 1000,
        scheduleStatus: 'paid',
        voidedAt: null,
      }),
    ).toBe('Paid');
  });
});
