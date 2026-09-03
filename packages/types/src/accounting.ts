import type {
  AccountType,
  LedgerClass,
  JournalSourceType,
  AccountingPeriodStatus,
  TrustLedgerEntryType,
  BankAccountClass,
  BankTransactionMatchStatus,
  InvoiceStatus,
  ExpenseStatus,
  ExpenseCategoryCode,
  OwnerStatementStatus,
} from './enums';

// Accounting-domain types (DATABASE.md §9, ACCOUNTING.md). TASKS.md M14.

export interface ChartOfAccount {
  id: string;
  orgId: string;
  code: string;
  name: string;
  accountType: AccountType;
  ledgerClass: LedgerClass;
  parentAccountId: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JournalEntry {
  id: string;
  orgId: string;
  entryDate: string;
  description: string | null;
  sourceType: JournalSourceType;
  sourceId: string | null;
  createdBy: string;
  postedAt: string;
  reversedByEntryId: string | null;
  isReversal: boolean;
}

export interface JournalLine {
  id: string;
  journalEntryId: string;
  accountId: string;
  debit: number;
  credit: number;
  propertyId: string | null;
  ownerId: string | null;
  tenantId: string | null;
  memo: string | null;
}

export interface AccountingPeriod {
  id: string;
  orgId: string;
  periodStart: string;
  periodEnd: string;
  status: AccountingPeriodStatus;
  closedBy: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  ledgerClass: LedgerClass;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

export type TrustLedgerStatus = 'active' | 'released';

export interface TrustLedger {
  id: string;
  orgId: string;
  tenantId: string;
  leaseId: string;
  openingBalance: number;
  currentBalance: number;
  interestRatePct: number;
  lastInterestAccrualAt: string | null;
  status: TrustLedgerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TrustLedgerEntry {
  id: string;
  trustLedgerId: string;
  journalEntryId: string;
  entryType: TrustLedgerEntryType;
  amount: number;
  createdAt: string;
}

export interface BankAccount {
  id: string;
  orgId: string;
  accountClass: BankAccountClass;
  bankName: string;
  accountNumberRef: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BankTransaction {
  id: string;
  bankAccountId: string;
  transactionDate: string;
  amount: number;
  description: string | null;
  reference: string | null;
  matchedJournalEntryId: string | null;
  matchedRentScheduleId: string | null;
  // Unified invoice-payment ledger (migration 20260101000158): mutually exclusive with
  // matchedRentScheduleId -- a bank transaction is either evidence for a rent-schedule match or a
  // manual/rent invoice payment, never both.
  matchedInvoicePaymentId: string | null;
  matchStatus: BankTransactionMatchStatus;
  createdAt: string;
  // V1 launch-completion pass (migration 20260101000146): optional manual tags plus the second
  // real matching destination (Expense), alongside the existing rent-schedule matching above.
  propertyId: string | null;
  unitId: string | null;
  tenantId: string | null;
  vendorId: string | null;
  category: string | null;
  documentId: string | null;
  notes: string | null;
  expenseId: string | null;
}

export interface Invoice {
  id: string;
  orgId: string;
  invoiceNumber: string;
  leaseId: string;
  tenantId: string;
  period: string;
  amount: number;
  status: InvoiceStatus;
  issuedAt: string | null;
  pdfDocumentId: string | null;
  emailedAt: string | null;
  // Overnight V1 completion pass, Part B (migration 20260101000152): 'rent_schedule' invoices are
  // unchanged, produced only by invoice_rent_schedule(); 'manual' invoices are the new one-off
  // tenant-charge path (utilities, parking, repairs, etc.), never touching rent_schedules.
  source: 'rent_schedule' | 'manual';
  description: string | null;
  notes: string | null;
  reference: string | null;
  createdByUserId: string | null;
  // Unified invoice-payment ledger (migration 20260101000158): never deleted, remains visible;
  // excluded from outstanding-balance totals; cannot be voided while any non-reversed payment
  // exists (reverse first) and cannot receive a new payment once void.
  voidedAt: string | null;
  voidedByUserId: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvoicePayment {
  id: string;
  orgId: string;
  tenantId: string;
  invoiceId: string;
  amount: number;
  paidAt: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  recordedBy: string | null;
  bankTransactionId: string | null;
  // Unified invoice-payment ledger (migration 20260101000158): the original row is never edited
  // beyond these three columns, never deleted -- reverse_invoice_payment() is the only path that
  // may set them.
  reversedAt: string | null;
  reversedByUserId: string | null;
  reversalReason: string | null;
  createdAt: string;
}

export interface Expense {
  id: string;
  orgId: string;
  propertyId: string;
  unitId: string | null;
  vendorId: string | null;
  category: string;
  categoryCode: ExpenseCategoryCode;
  amount: number;
  status: ExpenseStatus;
  documentId: string | null;
  journalEntryId: string | null;
  referenceNumber: string | null;
  invoiceDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerStatement {
  id: string;
  orgId: string;
  ownerId: string;
  periodStart: string;
  periodEnd: string;
  rentCollected: number;
  expensesTotal: number;
  managementFee: number;
  reserveAmount: number;
  netPayable: number;
  amountPaid: number;
  outstandingBalance: number;
  status: OwnerStatementStatus;
  payoutMatchedTransactionId: string | null;
  pdfDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// One row per payout event against an owner_statements row -- a statement may now be paid across
// multiple partial payments (Stage 2, commercial-launch execution plan), each matched to its own
// bank transaction. The full distribution history for a statement, not just its latest payout.
export interface OwnerStatementPayout {
  id: string;
  ownerStatementId: string;
  bankTransactionId: string;
  amount: number;
  journalEntryId: string;
  createdAt: string;
  createdBy: string | null;
}

// Cash Management (Stage 3 Phase 7, commercial-launch execution plan): a physically-received cash
// payment, logged separately from bank_transactions since the money hasn't reached the bank yet.
// `deposited*`/`variance`/`journalEntryId` stay null until confirm_cash_receipt_deposit() runs.
export interface CashReceipt {
  id: string;
  orgId: string;
  propertyId: string;
  leaseId: string | null;
  rentScheduleId: string | null;
  amount: number;
  receiptNumber: string;
  receivedBy: string;
  receivedAt: string;
  documentId: string | null;
  depositedAt: string | null;
  depositBankTransactionId: string | null;
  depositedAmount: number | null;
  variance: number | null;
  journalEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PaymentMethod = 'bank_transfer' | 'cash' | 'eft' | 'card' | 'other';

// ACCOUNTING.md §7 -- one line per property/account for a given SA tax year, computed live from
// journal_lines (never stored). propertyName is resolved at the API layer (compute_tax_pack()
// itself only returns property_id), null for lines with no property attribution.
export interface TaxPackLine {
  propertyId: string | null;
  propertyName: string | null;
  accountType: 'income' | 'expense';
  accountCode: string;
  accountName: string;
  amount: number;
}
