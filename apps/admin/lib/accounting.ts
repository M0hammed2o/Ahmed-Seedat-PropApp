import 'server-only';
import type {
  AccountingPeriod,
  BankAccount,
  BankTransaction,
  ChartOfAccount,
  Expense,
  Invoice,
  JournalEntry,
  TrustLedger,
} from '@propvault/types';

// Accounting-domain row mapping (apps/admin/app/api/v1/{chart-of-accounts,journal-entries,
// accounting-periods,trial-balance,expenses,bank-accounts,bank-transactions,trust-ledgers}).

interface ChartOfAccountRow {
  id: string;
  org_id: string;
  code: string;
  name: string;
  account_type: string;
  ledger_class: string;
  parent_account_id: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function mapChartOfAccountRow(row: ChartOfAccountRow): ChartOfAccount {
  return {
    id: row.id,
    orgId: row.org_id,
    code: row.code,
    name: row.name,
    accountType: row.account_type as ChartOfAccount['accountType'],
    ledgerClass: row.ledger_class as ChartOfAccount['ledgerClass'],
    parentAccountId: row.parent_account_id,
    isSystem: row.is_system,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface JournalEntryRow {
  id: string;
  org_id: string;
  entry_date: string;
  description: string | null;
  source_type: string;
  source_id: string | null;
  created_by: string;
  posted_at: string;
  reversed_by_entry_id: string | null;
  is_reversal: boolean;
}

export function mapJournalEntryRow(row: JournalEntryRow): JournalEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    entryDate: row.entry_date,
    description: row.description,
    sourceType: row.source_type as JournalEntry['sourceType'],
    sourceId: row.source_id,
    createdBy: row.created_by,
    postedAt: row.posted_at,
    reversedByEntryId: row.reversed_by_entry_id,
    isReversal: row.is_reversal,
  };
}

interface AccountingPeriodRow {
  id: string;
  org_id: string;
  period_start: string;
  period_end: string;
  status: string;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
}

export function mapAccountingPeriodRow(row: AccountingPeriodRow): AccountingPeriod {
  return {
    id: row.id,
    orgId: row.org_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status as AccountingPeriod['status'],
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    createdAt: row.created_at,
  };
}

interface ExpenseRow {
  id: string;
  org_id: string;
  property_id: string;
  vendor_id: string | null;
  category: string;
  amount: number;
  status: string;
  document_id: string | null;
  journal_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

export function mapExpenseRow(row: ExpenseRow): Expense {
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    vendorId: row.vendor_id,
    category: row.category,
    amount: row.amount,
    status: row.status as Expense['status'],
    documentId: row.document_id,
    journalEntryId: row.journal_entry_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface BankAccountRow {
  id: string;
  org_id: string;
  account_class: string;
  bank_name: string;
  account_number_ref: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function mapBankAccountRow(row: BankAccountRow): BankAccount {
  return {
    id: row.id,
    orgId: row.org_id,
    accountClass: row.account_class as BankAccount['accountClass'],
    bankName: row.bank_name,
    accountNumberRef: row.account_number_ref,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface BankTransactionRow {
  id: string;
  bank_account_id: string;
  transaction_date: string;
  amount: number;
  description: string | null;
  reference: string | null;
  matched_journal_entry_id: string | null;
  matched_rent_schedule_id: string | null;
  match_status: string;
  created_at: string;
}

export function mapBankTransactionRow(row: BankTransactionRow): BankTransaction {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    transactionDate: row.transaction_date,
    amount: row.amount,
    description: row.description,
    reference: row.reference,
    matchedJournalEntryId: row.matched_journal_entry_id,
    matchedRentScheduleId: row.matched_rent_schedule_id,
    matchStatus: row.match_status as BankTransaction['matchStatus'],
    createdAt: row.created_at,
  };
}

interface InvoiceRow {
  id: string;
  org_id: string;
  lease_id: string;
  tenant_id: string;
  period: string;
  amount: number;
  status: string;
  issued_at: string | null;
  pdf_document_id: string | null;
  emailed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapInvoiceRow(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    orgId: row.org_id,
    leaseId: row.lease_id,
    tenantId: row.tenant_id,
    period: row.period,
    amount: row.amount,
    status: row.status as Invoice['status'],
    issuedAt: row.issued_at,
    pdfDocumentId: row.pdf_document_id,
    emailedAt: row.emailed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface TrustLedgerRow {
  id: string;
  org_id: string;
  tenant_id: string;
  lease_id: string;
  opening_balance: number;
  current_balance: number;
  interest_rate_pct: number;
  last_interest_accrual_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function mapTrustLedgerRow(row: TrustLedgerRow): TrustLedger {
  return {
    id: row.id,
    orgId: row.org_id,
    tenantId: row.tenant_id,
    leaseId: row.lease_id,
    openingBalance: row.opening_balance,
    currentBalance: row.current_balance,
    interestRatePct: row.interest_rate_pct,
    lastInterestAccrualAt: row.last_interest_accrual_at,
    status: row.status as TrustLedger['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
