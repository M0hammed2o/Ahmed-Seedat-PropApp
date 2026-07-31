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

export interface TrustLedger {
  id: string;
  orgId: string;
  tenantId: string;
  leaseId: string;
  openingBalance: number;
  currentBalance: number;
  interestRatePct: number;
  lastInterestAccrualAt: string | null;
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
  matchStatus: BankTransactionMatchStatus;
  createdAt: string;
}

export interface Invoice {
  id: string;
  orgId: string;
  leaseId: string;
  tenantId: string;
  period: string;
  amount: number;
  status: InvoiceStatus;
  issuedAt: string | null;
  pdfDocumentId: string | null;
  emailedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  orgId: string;
  propertyId: string;
  vendorId: string | null;
  category: string;
  amount: number;
  status: ExpenseStatus;
  documentId: string | null;
  journalEntryId: string | null;
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
  netPayable: number;
  status: OwnerStatementStatus;
  payoutMatchedTransactionId: string | null;
  pdfDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}
