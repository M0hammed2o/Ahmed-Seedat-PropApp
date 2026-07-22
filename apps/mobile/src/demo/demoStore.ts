import { create } from 'zustand';
import type {
  Bill,
  BillStatus,
  DocumentRecord,
  DocumentType,
  Payment,
  PaymentMatch,
  Property,
} from '@propvault/types';
import type { PropertyInput } from '@propvault/validation';
import {
  DEMO_BILLS,
  DEMO_CATEGORIES,
  DEMO_DOCUMENTS,
  DEMO_EXPECTED_CATEGORIES,
  DEMO_NOTIFICATIONS,
  DEMO_PAYMENTS,
  DEMO_PAYMENT_MATCHES,
  DEMO_PROPERTIES,
  DEMO_SUBSCRIPTION,
  DEMO_USER,
  type DemoNotification,
} from './mockData';

/**
 * In-memory "database" for demo mode — seeded from mockData.ts, mutated by the same actions a
 * real repository would expose, so screens built against this feel identical to the production
 * data flow (upload → extraction → confirm → checklist updates). Nothing here ever touches
 * Supabase; it exists purely for client demonstrations (see DECISIONS.md, Phase 2 entry).
 */
interface DemoState {
  properties: Property[];
  documents: DocumentRecord[];
  bills: Bill[];
  payments: Payment[];
  paymentMatches: PaymentMatch[];
  notifications: DemoNotification[];
  expectedCategories: Record<string, string[]>;
  subscription: typeof DEMO_SUBSCRIPTION;

  addProperty: (input: PropertyInput) => Property;
  archiveProperty: (id: string) => void;
  restoreProperty: (id: string) => void;

  addDocument: (input: {
    propertyId: string;
    categorySlug: string;
    documentType: DocumentType;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    billingYear: number;
    billingMonth: number;
  }) => DocumentRecord;

  saveBillFromExtraction: (
    documentId: string,
    fields: Partial<
      Omit<Bill, 'id' | 'documentId' | 'ownerUserId' | 'propertyId' | 'createdAt' | 'updatedAt'>
    >,
  ) => Bill;

  savePaymentFromExtraction: (
    documentId: string,
    fields: Partial<Omit<Payment, 'id' | 'documentId' | 'ownerUserId' | 'createdAt' | 'updatedAt'>>,
  ) => Payment;

  proposeMatch: (
    paymentId: string,
    billId: string,
    score: number,
    matchedFields: string[],
    conflictingFields: string[],
  ) => PaymentMatch;
  confirmMatch: (matchId: string) => void;
  rejectMatch: (matchId: string) => void;

  markNotificationRead: (id: string) => void;
}

let idCounter = 1000;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export const useDemoStore = create<DemoState>((set, get) => ({
  properties: DEMO_PROPERTIES,
  documents: DEMO_DOCUMENTS,
  bills: DEMO_BILLS,
  payments: DEMO_PAYMENTS,
  paymentMatches: DEMO_PAYMENT_MATCHES,
  notifications: DEMO_NOTIFICATIONS,
  expectedCategories: DEMO_EXPECTED_CATEGORIES,
  subscription: DEMO_SUBSCRIPTION,

  addProperty: (input) => {
    const now = new Date().toISOString();
    const property: Property = {
      id: nextId('prop'),
      ownerUserId: DEMO_USER.id,
      nickname: input.nickname,
      fullAddress: [
        input.addressLine1,
        input.addressLine2,
        input.suburb,
        input.city,
        input.province,
        input.postalCode,
      ]
        .filter(Boolean)
        .join(', '),
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2 ?? null,
      suburb: input.suburb ?? null,
      city: input.city,
      province: input.province ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country,
      propertyType: input.propertyType,
      municipalAccountNumber: input.municipalAccountNumber ?? null,
      notes: input.notes ?? null,
      imagePath: null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ properties: [property, ...state.properties] }));
    return property;
  },

  archiveProperty: (id) =>
    set((state) => ({
      properties: state.properties.map((p) =>
        p.id === id ? { ...p, status: 'archived', updatedAt: new Date().toISOString() } : p,
      ),
    })),

  restoreProperty: (id) =>
    set((state) => ({
      properties: state.properties.map((p) =>
        p.id === id ? { ...p, status: 'active', updatedAt: new Date().toISOString() } : p,
      ),
    })),

  addDocument: (input) => {
    const now = new Date().toISOString();
    const category =
      DEMO_CATEGORIES.find((c) => c.slug === input.categorySlug) ?? DEMO_CATEGORIES[0]!;
    const doc: DocumentRecord = {
      id: nextId('doc'),
      ownerUserId: DEMO_USER.id,
      propertyId: input.propertyId,
      categoryId: category.id,
      documentType: input.documentType,
      storagePath: `${DEMO_USER.id}/${input.propertyId}/${input.billingYear}/${input.billingMonth}/${nextId('file')}`,
      originalFileName: input.fileName,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      checksumSha256: nextId('checksum'),
      billingYear: input.billingYear,
      billingMonth: input.billingMonth,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ documents: [doc, ...state.documents] }));
    return doc;
  },

  saveBillFromExtraction: (documentId, fields) => {
    const document = get().documents.find((d) => d.id === documentId);
    const now = new Date().toISOString();
    const bill: Bill = {
      id: nextId('bill'),
      documentId,
      ownerUserId: DEMO_USER.id,
      propertyId: document?.propertyId ?? '',
      supplierName: fields.supplierName ?? null,
      billingMonth: fields.billingMonth ?? document?.billingMonth ?? null,
      billingYear: fields.billingYear ?? document?.billingYear ?? null,
      statementDate: fields.statementDate ?? null,
      dueDate: fields.dueDate ?? null,
      amountDue: fields.amountDue ?? null,
      amountPaid: 0,
      accountNumber: fields.accountNumber ?? null,
      invoiceNumber: fields.invoiceNumber ?? null,
      paymentReference: fields.paymentReference ?? null,
      notes: fields.notes ?? null,
      status: (fields.status as BillStatus) ?? 'unpaid',
      extractionConfidence: fields.extractionConfidence ?? null,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ bills: [bill, ...state.bills] }));
    return bill;
  },

  savePaymentFromExtraction: (documentId, fields) => {
    const document = get().documents.find((d) => d.id === documentId);
    const now = new Date().toISOString();
    const payment: Payment = {
      id: nextId('payment'),
      documentId,
      ownerUserId: DEMO_USER.id,
      propertyId: document?.propertyId ?? null,
      recipientName: fields.recipientName ?? null,
      amount: fields.amount ?? null,
      paymentReference: fields.paymentReference ?? null,
      paymentDate: fields.paymentDate ?? null,
      extractionConfidence: fields.extractionConfidence ?? null,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ payments: [payment, ...state.payments] }));
    return payment;
  },

  proposeMatch: (paymentId, billId, score, matchedFields, conflictingFields) => {
    const now = new Date().toISOString();
    const match: PaymentMatch = {
      id: nextId('match'),
      paymentId,
      billId,
      ownerUserId: DEMO_USER.id,
      matchScore: score,
      status: 'proposed',
      matchedFields,
      conflictingFields,
      confirmedAt: null,
      confirmedByUserId: null,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ paymentMatches: [match, ...state.paymentMatches] }));
    return match;
  },

  confirmMatch: (matchId) => {
    const now = new Date().toISOString();
    set((state) => {
      const match = state.paymentMatches.find((m) => m.id === matchId);
      if (!match) return state;
      const payment = state.payments.find((p) => p.id === match.paymentId);
      return {
        paymentMatches: state.paymentMatches.map((m) =>
          m.id === matchId
            ? {
                ...m,
                status: 'confirmed',
                confirmedAt: now,
                confirmedByUserId: DEMO_USER.id,
                updatedAt: now,
              }
            : m,
        ),
        bills: state.bills.map((b) =>
          b.id === match.billId
            ? {
                ...b,
                status: 'paid',
                amountPaid: payment?.amount ?? b.amountDue ?? b.amountPaid,
                updatedAt: now,
              }
            : b,
        ),
      };
    });
  },

  rejectMatch: (matchId) =>
    set((state) => ({
      paymentMatches: state.paymentMatches.map((m) =>
        m.id === matchId ? { ...m, status: 'rejected', updatedAt: new Date().toISOString() } : m,
      ),
    })),

  markNotificationRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),
}));

export { DEMO_CATEGORIES, DEMO_USER } from './mockData';
