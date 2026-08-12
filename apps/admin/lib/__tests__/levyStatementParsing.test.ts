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

// Task 3 follow-up (WORKLOG.md this date): a second, more realistic synthetic fixture modeled
// after the general SHAPE of real South African sectional-title/body-corporate statements
// (opening balance, payment received, monthly levy, CSOS levy, unit/common water, sewer, special
// levy, interest, credit, closing balance, a statement reference, a due date) -- entirely
// fictional scheme/unit/amount values, never the real reference statement inspected earlier this
// session. Deliberately a DIFFERENT fictional managing agent's wording/ordering than the first
// fixture above, so neither test accidentally overfits the parser to one format.
const REALISTIC_FIXTURE_TEXT = `
FICTIONAL PROPERTY CONSULTING (PTY) LTD
Statement for: Fictional Gardens Body Corporate
Unit: F99/000
Statement date: 2026-07-01
Statement reference: FIC0000/099
Payment due date: 2026-07-25

Opening Balance R1,234.56
Payment Received -R1,234.56
Monthly Levy R1,850.00
CSOS Levy R48.00
Unit Water R95.30
Common Water R110.75
Sewer R64.20
Special Levy R2,500.00
Interest R12.45
Credit -R50.00
Closing Balance R4,865.26
`;

describe('parseLevyStatementLineItems (realistic fixture)', () => {
  it('extracts every real category from a fuller, differently-worded statement shape', () => {
    const items = parseLevyStatementLineItems(REALISTIC_FIXTURE_TEXT);
    const categories = items.map((i) => i.category);
    expect(categories).toEqual(
      expect.arrayContaining([
        'monthly_levy',
        'csos_levy',
        'unit_water',
        'common_water',
        'sewer',
        'special_levy',
        'interest',
      ]),
    );
  });

  it('correctly parses comma-thousands-separated currency (R1,234.56 style)', () => {
    const items = parseLevyStatementLineItems(REALISTIC_FIXTURE_TEXT);
    const specialLevy = items.find((i) => i.category === 'special_levy');
    expect(specialLevy?.amount).toBe(2500);
    const opening = items.find((i) => i.description.toLowerCase().includes('opening balance'));
    expect(opening?.amount).toBe(1234.56);
  });

  it('classifies "Payment Received" and "Credit" as payment/credit, never charge, regardless of sign convention', () => {
    const items = parseLevyStatementLineItems(REALISTIC_FIXTURE_TEXT);
    const payment = items.find((i) => i.description.toLowerCase().includes('payment received'));
    expect(payment?.lineType).toBe('payment');
    const credit = items.find((i) => i.description.toLowerCase() === 'credit');
    expect(credit?.lineType).toBe('credit');
  });

  it('special levy is never miscategorised as the generic monthly levy', () => {
    const items = parseLevyStatementLineItems(REALISTIC_FIXTURE_TEXT);
    const specialLevy = items.find((i) => i.description.toLowerCase().includes('special levy'));
    expect(specialLevy?.category).toBe('special_levy');
    expect(specialLevy?.category).not.toBe('monthly_levy');
  });

  it('every ordinary charge line (levy/water/sewer/interest) is classified as a charge', () => {
    const items = parseLevyStatementLineItems(REALISTIC_FIXTURE_TEXT);
    for (const category of [
      'monthly_levy',
      'csos_levy',
      'unit_water',
      'common_water',
      'sewer',
      'interest',
    ]) {
      const item = items.find((i) => i.category === category);
      expect(item?.lineType).toBe('charge');
    }
  });

  it('does NOT parse space-separated-thousands, comma-decimal currency (R 1 234,56) -- a disclosed, known limitation that safely SKIPS the line rather than misreading it', () => {
    // Documents current, honest behaviour rather than claiming support that doesn't exist: this
    // locale convention (space thousands separator, comma decimal, no literal '.') is a
    // genuinely different format from the R1,234.56 style this parser supports. The amount
    // pattern requires a literal decimal point, which this format never has -- so the line is
    // skipped entirely (staff can add it manually during review) rather than the parser guessing
    // between two conventions and risking a silently WRONG value on the common R1,234.56 case.
    // Verified this is the actual regex behaviour, not assumed.
    const items = parseLevyStatementLineItems('Monthly Levy R 1 234,56\n');
    expect(items.find((i) => i.category === 'monthly_levy')).toBeUndefined();
    expect(items).toEqual([]);
  });

  it('total charges minus payments/credits reconciles to a sane figure for manual review (not asserted as accounting truth)', () => {
    const items = parseLevyStatementLineItems(REALISTIC_FIXTURE_TEXT);
    const chargeTotal = items
      .filter((i) => i.lineType === 'charge')
      .reduce((sum, i) => sum + i.amount, 0);
    const paymentAndCreditTotal = items
      .filter((i) => i.lineType === 'payment' || i.lineType === 'credit')
      .reduce((sum, i) => sum + i.amount, 0);
    expect(chargeTotal).toBeGreaterThan(0);
    expect(paymentAndCreditTotal).toBeGreaterThan(0);
  });
});
