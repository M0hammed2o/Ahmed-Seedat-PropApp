import type { AccountType, LedgerClass, JournalSourceType, AccountingPeriodStatus } from './enums';

// Accounting-domain types (DATABASE.md §9, ACCOUNTING.md). TASKS.md M14 part 1: the core ledger.
// No generic "create a journal entry" client type exists on purpose -- ACCOUNTING.md §3: "no
// generic post a journal entry API exists." Typed posting operations (record an expense, confirm
// a payment, etc.) get their own input types as M14's later increments build them.

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
