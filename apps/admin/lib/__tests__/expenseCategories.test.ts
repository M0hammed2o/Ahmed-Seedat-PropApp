import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORY_CODES } from '@propvault/types';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_OPTIONS } from '../expenseCategories';

// Web financials V1 pass, part 2 (WORKLOG.md this date): a drift guard -- if a new canonical
// category is ever added to packages/types without a matching label here, the expense entry
// dropdown would silently render "undefined" for it. Fails loudly instead.
describe('EXPENSE_CATEGORY_LABELS / EXPENSE_CATEGORY_OPTIONS', () => {
  it('has exactly one label per canonical category code, no more, no fewer', () => {
    expect(Object.keys(EXPENSE_CATEGORY_LABELS).sort()).toEqual([...EXPENSE_CATEGORY_CODES].sort());
  });

  it('every label is non-empty, human-readable text', () => {
    for (const code of EXPENSE_CATEGORY_CODES) {
      expect(EXPENSE_CATEGORY_LABELS[code].length).toBeGreaterThan(0);
    }
  });

  it('options list has the same codes as the canonical set, same order', () => {
    expect(EXPENSE_CATEGORY_OPTIONS.map((o) => o.value)).toEqual([...EXPENSE_CATEGORY_CODES]);
  });

  it('rates_taxes and levies get distinct, specific labels -- never merged back into one "Rates & levies" option', () => {
    expect(EXPENSE_CATEGORY_LABELS.rates_taxes).not.toBe(EXPENSE_CATEGORY_LABELS.levies);
    expect(EXPENSE_CATEGORY_LABELS.rates_taxes.toLowerCase()).toContain('rates');
    expect(EXPENSE_CATEGORY_LABELS.levies.toLowerCase()).toContain('levies');
  });
});
