import 'server-only';
import type { AccountingPeriod, ChartOfAccount, JournalEntry } from '@propvault/types';

// Accounting-domain row mapping (apps/admin/app/api/v1/{chart-of-accounts,journal-entries,
// accounting-periods,trial-balance}).

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
