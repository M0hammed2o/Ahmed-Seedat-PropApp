import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORY_CODES } from '@propvault/types';
import { expenseCreateSchema } from '../accounting';

// Web financials V1 pass, part 2 (WORKLOG.md this date): categoryCode is the canonical
// classification -- this proves the schema actually enforces it (required, and restricted to the
// fixed set) rather than merely documenting it.

const BASE = {
  orgId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
  category: 'Rates & taxes',
  amount: 1500,
};

describe('expenseCreateSchema', () => {
  it('accepts a valid categoryCode alongside the free-text category', () => {
    const result = expenseCreateSchema.safeParse({ ...BASE, categoryCode: 'rates_taxes' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categoryCode).toBe('rates_taxes');
      expect(result.data.category).toBe('Rates & taxes');
    }
  });

  it('rejects a missing categoryCode', () => {
    const result = expenseCreateSchema.safeParse(BASE);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.categoryCode).toBeDefined();
    }
  });

  it('rejects a categoryCode that is not one of the canonical values -- an owner cannot invent a new financial classification client-side', () => {
    const result = expenseCreateSchema.safeParse({ ...BASE, categoryCode: 'plumbing_repair' });
    expect(result.success).toBe(false);
  });

  it('accepts every documented canonical category code', () => {
    for (const code of EXPENSE_CATEGORY_CODES) {
      const result = expenseCreateSchema.safeParse({ ...BASE, categoryCode: code });
      expect(result.success).toBe(true);
    }
  });

  it('a free-text category describing something unrelated does not change categoryCode validity -- the two fields are independent', () => {
    const result = expenseCreateSchema.safeParse({
      ...BASE,
      category: 'eThekwini Municipality September account',
      categoryCode: 'rates_taxes',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categoryCode).toBe('rates_taxes');
    }
  });
});
