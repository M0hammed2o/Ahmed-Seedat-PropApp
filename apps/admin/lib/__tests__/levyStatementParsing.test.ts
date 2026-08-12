import { describe, expect, it } from 'vitest';
import { parseLevyStatementLineItems } from '../levyStatementParsing';

// Property compliance workflow (WORKLOG.md this date), PHASE 10/11. Synthetic fixture text only
// (fictional amounts/wording) -- never the real reference statement, per this task's own
// instruction not to commit customer/reference material. Proves the heuristic parser: extracts a
// trailing amount + description per line, classifies charge/payment/credit, and never throws on
// lines it can't confidently parse.

const SYNTHETIC_STATEMENT_TEXT = `
Test Body Corporate Statement
Opening balance: R 0.00
Monthly levy R 1500.00
CSOS levy R 45.00
Unit water R 120.50
Common water R 80.00
General sewer R 60.00
Payment received -R 1500.00
This is a line of text with no trailing amount at all
Special levy R 250.00
Closing balance: R 555.50
`;

describe('parseLevyStatementLineItems', () => {
  it('extracts a description + amount for every recognisable line', () => {
    const items = parseLevyStatementLineItems(SYNTHETIC_STATEMENT_TEXT);
    const categories = items.map((i) => i.category);
    expect(categories).toContain('monthly_levy');
    expect(categories).toContain('csos_levy');
    expect(categories).toContain('unit_water');
    expect(categories).toContain('common_water');
    expect(categories).toContain('sewer');
    expect(categories).toContain('special_levy');
  });

  it('classifies a negative amount as a payment, never a charge', () => {
    const items = parseLevyStatementLineItems(SYNTHETIC_STATEMENT_TEXT);
    const payment = items.find((i) => i.description.toLowerCase().includes('payment received'));
    expect(payment).toBeDefined();
    expect(payment?.lineType).toBe('payment');
    expect(payment?.amount).toBeGreaterThan(0); // stored as a positive magnitude, lineType carries the sign's meaning
  });

  it('classifies an ordinary levy line as a charge', () => {
    const items = parseLevyStatementLineItems(SYNTHETIC_STATEMENT_TEXT);
    const levy = items.find((i) => i.category === 'monthly_levy');
    expect(levy?.lineType).toBe('charge');
    expect(levy?.amount).toBe(1500);
  });

  it('never throws and simply skips a line with no trailing amount', () => {
    expect(() => parseLevyStatementLineItems(SYNTHETIC_STATEMENT_TEXT)).not.toThrow();
    const items = parseLevyStatementLineItems(SYNTHETIC_STATEMENT_TEXT);
    expect(items.some((i) => i.description.includes('no trailing amount'))).toBe(false);
  });

  it('tags every extracted item as a disclosed heuristic with low confidence', () => {
    const items = parseLevyStatementLineItems(SYNTHETIC_STATEMENT_TEXT);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.confidence).toBeLessThan(0.5);
    }
  });

  it('returns an empty array, not an error, for text with no amounts at all', () => {
    expect(parseLevyStatementLineItems('No amounts here at all.')).toEqual([]);
  });
});
