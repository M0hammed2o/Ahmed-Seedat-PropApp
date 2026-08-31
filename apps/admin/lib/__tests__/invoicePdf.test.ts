import { describe, expect, it } from 'vitest';
import { renderInvoicePdf, type InvoicePdfData } from '../invoicePdf';

// Final hardening pass, P1 "Professional tenant invoice PDF" -- renderInvoicePdf() is a pure
// function (data in, Buffer out, no database access), so it's directly unit-testable without a
// server or real invoice row, same rationale as lib/invoicing.ts's computeInvoiceDisplayStatus().

const BASE: InvoicePdfData = {
  invoiceNumber: 'MIT-000001',
  status: 'issued',
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-07',
  reference: 'REF-1',
  description: 'Water and electricity',
  notes: 'Please pay promptly',
  lineItems: [
    { description: 'Water', quantity: 1, unitPrice: 250, amount: 250 },
    { description: 'Electricity', quantity: 1, unitPrice: 400, amount: 400 },
  ],
  amount: 650,
  currency: 'ZAR',
  tenantName: 'Naledi Khumalo',
  propertyNickname: 'Sea Point Apartment',
  unitLabel: 'Unit 1',
  org: {
    displayName: 'Demo Property Group',
    address: '1 Test Street, Cape Town',
    cipcRegNo: '2020/123456/07',
    vatNo: '4123456789',
    contactName: 'Ahmed Seedat',
    contactPhone: '+27000000000',
    contactEmail: 'billing@example.com',
    paymentInstructions: 'EFT to Test Bank, Account 12345',
    footer: 'Thank you for your business.',
  },
};

describe('renderInvoicePdf', () => {
  it('produces a real, non-trivial PDF buffer', async () => {
    const buffer = await renderInvoicePdf(BASE);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('does not throw and still produces a valid PDF when every optional org field is absent', async () => {
    const buffer = await renderInvoicePdf({
      ...BASE,
      reference: null,
      description: null,
      notes: null,
      org: {
        displayName: 'Minimal Org',
        address: null,
        cipcRegNo: null,
        vatNo: null,
        contactName: null,
        contactPhone: null,
        contactEmail: null,
        paymentInstructions: null,
        footer: null,
      },
    });
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders a draft invoice without throwing', async () => {
    const buffer = await renderInvoicePdf({ ...BASE, status: 'draft' });
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
