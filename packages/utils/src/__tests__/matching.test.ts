import { describe, expect, it } from 'vitest';
import { calculateMatchScore, type MatchInput } from '../matching';

const baseBill: MatchInput['bill'] = {
  ownerUserId: 'user-1',
  propertyId: 'prop-1',
  amountDue: 5000,
  accountNumber: '12345',
  invoiceNumber: null,
  paymentReference: null,
  supplierName: 'City of Cape Town',
  billingYear: 2026,
  billingMonth: 7,
  dueDate: '2026-07-25',
  statementDate: '2026-07-01',
};

const basePayment: MatchInput['payment'] = {
  ownerUserId: 'user-1',
  propertyId: 'prop-1',
  amount: 5000,
  paymentReference: '12345',
  recipientName: 'City of Cape Town',
  paymentDate: '2026-07-20',
};

describe('calculateMatchScore', () => {
  it('produces a strong match (>=90) when everything lines up', () => {
    const result = calculateMatchScore({ bill: baseBill, payment: basePayment });
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.conflictingFields).toHaveLength(0);
  });

  it('never proposes a match across different owners, regardless of other fields matching', () => {
    const result = calculateMatchScore({
      bill: baseBill,
      payment: { ...basePayment, ownerUserId: 'user-2' },
    });
    expect(result.score).toBe(0);
    expect(result.conflictingFields).toContain('ownership');
  });

  it('does not produce a strong match from amount alone (brief: not amount-only matching)', () => {
    const result = calculateMatchScore({
      bill: baseBill,
      payment: {
        ...basePayment,
        paymentReference: 'unrelated-ref',
        recipientName: 'Someone Else Entirely',
        paymentDate: '2025-01-01',
      },
    });
    expect(result.score).toBeLessThan(90);
  });

  it('does not drop out of the strong-match band from a supplier/recipient name mismatch alone (brief: recipient text commonly differs from supplier name, e.g. "Municipality" vs "City of Cape Town")', () => {
    const result = calculateMatchScore({
      bill: baseBill,
      payment: { ...basePayment, recipientName: 'Totally Different Name' },
    });
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.conflictingFields).toContain('supplier');
  });

  it('falls in the possible-match band (70-89) with two moderate signal mismatches', () => {
    const result = calculateMatchScore({
      bill: baseBill,
      payment: {
        ...basePayment,
        recipientName: 'Totally Different Name',
        paymentDate: '2025-01-01',
      },
    });
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.score).toBeLessThan(90);
    expect(result.conflictingFields).toContain('supplier');
    expect(result.conflictingFields).toContain('period');
  });

  it('detects an ambiguous / no match below 70 when several fields conflict', () => {
    const result = calculateMatchScore({
      bill: baseBill,
      payment: {
        ...basePayment,
        amount: 8000,
        paymentReference: 'nope',
        recipientName: 'Different Entity',
        paymentDate: '2020-01-01',
      },
    });
    expect(result.score).toBeLessThan(70);
  });

  it('caps the score below the strong-match threshold when a duplicate use is flagged', () => {
    const result = calculateMatchScore({
      bill: baseBill,
      payment: basePayment,
      alreadyConfirmedElsewhere: true,
    });
    expect(result.duplicateWarning).toBe(true);
    expect(result.score).toBeLessThan(70);
    expect(result.conflictingFields).toContain('duplicate_use');
  });

  it('gives partial amount credit within 1% tolerance', () => {
    const result = calculateMatchScore({
      bill: baseBill,
      payment: { ...basePayment, amount: 5040 }, // 0.8% over
    });
    expect(result.matchedFields).toContain('amount_within_tolerance');
  });
});
