import type { BillStatus, DocumentType, PaymentMatchStatus } from './enums';

export interface DocumentCategory {
  id: string;
  slug: string;
  label: string;
  isDefault: boolean;
  ownerUserId: string | null; // null for default (system) categories, set for customer-created ones
  createdAt: string;
}

export interface DocumentRecord {
  id: string;
  /** Legacy PropVault-era rows may have this null; every org-scoped upload (TASKS.md M11/V1) always sets it. */
  ownerUserId: string | null;
  orgId: string | null;
  propertyId: string;
  categoryId: string;
  documentType: DocumentType;
  storagePath: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  checksumSha256: string;
  billingYear: number | null;
  billingMonth: number | null; // 1-12
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Bill {
  id: string;
  documentId: string;
  ownerUserId: string;
  propertyId: string;
  supplierName: string | null;
  billingMonth: number | null;
  billingYear: number | null;
  statementDate: string | null;
  dueDate: string | null;
  amountDue: number | null;
  amountPaid: number;
  accountNumber: string | null;
  invoiceNumber: string | null;
  paymentReference: string | null;
  notes: string | null;
  status: BillStatus;
  extractionConfidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  documentId: string;
  ownerUserId: string;
  propertyId: string | null;
  recipientName: string | null;
  amount: number | null;
  paymentReference: string | null;
  paymentDate: string | null;
  extractionConfidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentMatch {
  id: string;
  paymentId: string;
  billId: string;
  ownerUserId: string;
  matchScore: number; // 0-100
  status: PaymentMatchStatus;
  matchedFields: string[];
  conflictingFields: string[];
  confirmedAt: string | null;
  confirmedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
