import { EXPENSE_CATEGORY_CODES, type ExpenseCategoryCode } from '@propvault/types';

// Web financials V1 pass, part 2 (WORKLOG.md this date): the one place the canonical
// expense_category_code -> human label mapping lives, shared by the expense entry form, the
// expenses table, and the financial-overview panels. Deliberately NOT server-only (unlike
// lib/accounting.ts) -- ExpenseForm.tsx is a client component and needs this too.

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategoryCode, string> = {
  rates_taxes: 'Rates & taxes',
  levies: 'Levies',
  water: 'Water',
  electricity: 'Electricity',
  maintenance: 'Maintenance',
  security: 'Security',
  insurance: 'Insurance',
  cleaning: 'Cleaning',
  management: 'Management',
  other: 'Other',
};

export const EXPENSE_CATEGORY_OPTIONS: { value: ExpenseCategoryCode; label: string }[] =
  EXPENSE_CATEGORY_CODES.map((code) => ({ value: code, label: EXPENSE_CATEGORY_LABELS[code] }));
