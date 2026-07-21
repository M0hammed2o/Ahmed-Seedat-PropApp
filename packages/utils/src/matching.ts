import type { Bill, Payment } from '@propvault/types';

/**
 * Payment-proof matching scorer (see brief's PAYMENT-PROOF MATCHING section and
 * DECISIONS.md / ARCHITECTURE.md's "Data flow: upload → extraction → match → checklist").
 *
 * Deliberately NOT "match only because amounts are equal" — amount is one of several weighted
 * signals, and the top band (own ownership) is a hard gate, not a weighted signal, since a
 * cross-user match must never be proposed regardless of how well other fields line up.
 *
 * Scoring weights sum to 100 when every signal is a full match:
 *   property            15
 *   amount               30
 *   account/reference    30
 *   supplier/recipient   10
 *   billing period/date  15
 *
 * Supplier/recipient carries the lowest weight deliberately: real proof-of-payment recipient
 * text commonly differs from the bill's supplier name (e.g. a bank statement line reading
 * "MUNICIPALITY EFT" against a bill from "City of Cape Town" — the brief's own worked example
 * pairs "City of Cape Town" with recipient "Municipality"). A mismatch there alone must not
 * knock an otherwise-confirmed match (matching account/reference + amount + period) out of the
 * "strong match" band.
 */
const WEIGHTS = {
  property: 15,
  amount: 30,
  reference: 30,
  supplier: 10,
  period: 15,
} as const;

export interface MatchInput {
  bill: Pick<
    Bill,
    | 'ownerUserId'
    | 'propertyId'
    | 'amountDue'
    | 'accountNumber'
    | 'invoiceNumber'
    | 'paymentReference'
    | 'supplierName'
    | 'billingYear'
    | 'billingMonth'
    | 'dueDate'
    | 'statementDate'
  >;
  payment: Pick<
    Payment,
    'ownerUserId' | 'propertyId' | 'amount' | 'paymentReference' | 'recipientName' | 'paymentDate'
  >;
  /** true if this payment already has a *confirmed* match to a different bill. */
  alreadyConfirmedElsewhere?: boolean;
}

export interface MatchResult {
  score: number; // 0-100
  matchedFields: string[];
  conflictingFields: string[];
  duplicateWarning: boolean;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

function tokenOverlapRatio(a: string | null | undefined, b: string | null | undefined): number {
  const ta = new Set((a ?? '').toLowerCase().split(/\W+/).filter(Boolean));
  const tb = new Set((b ?? '').toLowerCase().split(/\W+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
}

function withinDays(
  a: string | null | undefined,
  b: string | null | undefined,
  days: number,
): boolean {
  if (!a || !b) return false;
  const diffMs = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return diffMs <= days * 24 * 60 * 60 * 1000;
}

/** Cross-user matches are never proposed, regardless of other signals. */
export function calculateMatchScore(input: MatchInput): MatchResult {
  const { bill, payment } = input;
  const matchedFields: string[] = [];
  const conflictingFields: string[] = [];

  if (bill.ownerUserId !== payment.ownerUserId) {
    return {
      score: 0,
      matchedFields: [],
      conflictingFields: ['ownership'],
      duplicateWarning: false,
    };
  }

  let score = 0;

  // Property
  if (payment.propertyId) {
    if (payment.propertyId === bill.propertyId) {
      score += WEIGHTS.property;
      matchedFields.push('property');
    } else {
      conflictingFields.push('property');
    }
  }

  // Amount (exact match full weight; within 1% tolerance half weight; presence-only never scores)
  if (bill.amountDue != null && payment.amount != null) {
    const diff = Math.abs(bill.amountDue - payment.amount);
    const tolerance = bill.amountDue * 0.01;
    if (diff <= 0.01) {
      score += WEIGHTS.amount;
      matchedFields.push('amount');
    } else if (diff <= tolerance) {
      score += WEIGHTS.amount * 0.5;
      matchedFields.push('amount_within_tolerance');
    } else {
      conflictingFields.push('amount');
    }
  }

  // Account number / invoice number / payment reference — any one match is sufficient
  const paymentRef = normalize(payment.paymentReference);
  const candidates = [
    normalize(bill.accountNumber),
    normalize(bill.invoiceNumber),
    normalize(bill.paymentReference),
  ];
  if (paymentRef && candidates.some((c) => c && c === paymentRef)) {
    score += WEIGHTS.reference;
    matchedFields.push('reference');
  } else if (paymentRef && candidates.some((c) => c.length > 0)) {
    conflictingFields.push('reference');
  }

  // Supplier / recipient name (fuzzy token overlap — municipality naming varies)
  const overlap = tokenOverlapRatio(bill.supplierName, payment.recipientName);
  if (overlap >= 0.5) {
    score += WEIGHTS.supplier;
    matchedFields.push('supplier');
  } else if (bill.supplierName && payment.recipientName) {
    conflictingFields.push('supplier');
  }

  // Billing period / payment date proximity: payment date should fall near the statement/due window
  const referenceDate = bill.dueDate ?? bill.statementDate;
  if (withinDays(referenceDate, payment.paymentDate, 45)) {
    score += WEIGHTS.period;
    matchedFields.push('period');
  } else if (referenceDate && payment.paymentDate) {
    conflictingFields.push('period');
  }

  const duplicateWarning = Boolean(input.alreadyConfirmedElsewhere);
  if (duplicateWarning) {
    conflictingFields.push('duplicate_use');
    score = Math.min(score, 69); // never "strong" (see MATCH_THRESHOLDS) while a duplicate-use conflict exists
  }

  return { score: Math.round(score), matchedFields, conflictingFields, duplicateWarning };
}
