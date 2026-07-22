import type { DocumentType } from '@propvault/types';
import { useDemoStore } from './demoStore';

/**
 * Canned-but-plausible per-category extraction content for the demo AI reading flow. The
 * document picker in demo mode doesn't actually run OCR against whatever file the user selects
 * (there's no real file content to read without a live provider — see DOCUMENT_INTELLIGENCE.md);
 * instead it produces a realistic result for the category/type chosen, in the same shape the
 * real `MockDocumentIntelligenceProvider`/production provider would return, so the review and
 * matching screens work identically to how they will in production.
 */

export interface DemoExtractedBillFields {
  supplierName: string;
  accountNumber: string;
  invoiceNumber: string;
  amountDue: number;
  dueDate: string;
  statementDate: string;
  paymentReference: string;
  confidence: number;
}

export interface DemoExtractedPaymentFields {
  recipientName: string;
  amount: number;
  paymentReference: string;
  paymentDate: string;
  confidence: number;
}

const SUPPLIER_BY_CATEGORY: Record<string, string> = {
  water: 'City of Cape Town',
  electricity: 'City Power',
  rates_and_taxes: 'City of Cape Town Rates',
  levies: 'Body Corporate',
  insurance: 'Santam',
};

const AMOUNT_RANGE_BY_CATEGORY: Record<string, [number, number]> = {
  water: [420, 1250],
  electricity: [900, 2600],
  rates_and_taxes: [1800, 3600],
  levies: [1500, 2400],
  insurance: [1200, 2200],
};

function randomInRange([min, max]: [number, number]): number {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

function todayIso(offsetDays = 0): string {
  const d = new Date('2026-07-22T00:00:00Z');
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function generateBillExtraction(
  propertyId: string,
  categorySlug: string,
): DemoExtractedBillFields {
  const property = useDemoStore.getState().properties.find((p) => p.id === propertyId);
  const supplierBase = SUPPLIER_BY_CATEGORY[categorySlug] ?? 'Supplier';
  const supplierName =
    categorySlug === 'levies' ? `${property?.nickname ?? 'Property'} Body Corporate` : supplierBase;
  const accountNumber =
    property?.municipalAccountNumber ?? `40${Math.floor(10000000 + Math.random() * 89999999)}`;

  return {
    supplierName,
    accountNumber,
    invoiceNumber: `INV-${Math.floor(700000 + Math.random() * 99999)}`,
    amountDue: randomInRange(AMOUNT_RANGE_BY_CATEGORY[categorySlug] ?? [500, 1500]),
    dueDate: todayIso(4),
    statementDate: todayIso(-3),
    paymentReference: accountNumber,
    confidence: 0.86 + Math.random() * 0.1,
  };
}

/**
 * For a proof-of-payment upload, deliberately aligns the extracted amount/reference with the
 * property's largest outstanding bill in that category (if one exists) — this is what makes the
 * subsequent payment-matching screen genuinely score a strong match via the real
 * `calculateMatchScore` function, rather than a hardcoded "strong match" result.
 */
export function generatePaymentExtraction(
  propertyId: string,
  categorySlug?: string,
): DemoExtractedPaymentFields {
  const state = useDemoStore.getState();
  const property = state.properties.find((p) => p.id === propertyId);
  const outstandingBills = state.bills
    .filter(
      (b) =>
        b.propertyId === propertyId &&
        b.status !== 'paid' &&
        (!categorySlug || b.supplierName === SUPPLIER_BY_CATEGORY[categorySlug]),
    )
    .sort((a, b) => (b.amountDue ?? 0) - (a.amountDue ?? 0));

  const targetBill = outstandingBills[0];

  if (targetBill) {
    return {
      recipientName: targetBill.supplierName ?? 'Municipality',
      amount: targetBill.amountDue ?? randomInRange([500, 1500]),
      paymentReference: targetBill.accountNumber ?? property?.municipalAccountNumber ?? '',
      paymentDate: todayIso(-1),
      confidence: 0.88 + Math.random() * 0.08,
    };
  }

  return {
    recipientName: 'Municipality',
    amount: randomInRange([500, 1500]),
    paymentReference: property?.municipalAccountNumber ?? '',
    paymentDate: todayIso(-1),
    confidence: 0.75,
  };
}

export function generateExtraction(
  propertyId: string,
  categorySlug: string,
  documentType: DocumentType,
) {
  if (documentType === 'proof_of_payment' || documentType === 'receipt') {
    return {
      kind: 'payment' as const,
      fields: generatePaymentExtraction(propertyId, categorySlug),
    };
  }
  return { kind: 'bill' as const, fields: generateBillExtraction(propertyId, categorySlug) };
}
