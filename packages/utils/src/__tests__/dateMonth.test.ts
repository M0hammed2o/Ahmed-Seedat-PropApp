import { describe, expect, it } from 'vitest';
import { formatYearMonth, isOverdue, isSameYearMonth, monthLabel } from '../dateMonth';

describe('dateMonth helpers', () => {
  it('formats a year/month as a readable label', () => {
    expect(formatYearMonth({ year: 2026, month: 7 })).toBe('July 2026');
  });

  it('throws for an out-of-range month', () => {
    expect(() => monthLabel(13)).toThrow(RangeError);
  });

  it('treats a past due date as overdue', () => {
    expect(isOverdue('2020-01-01T00:00:00.000Z', new Date('2026-01-01'))).toBe(true);
  });

  it('treats a future due date as not overdue', () => {
    expect(isOverdue('2030-01-01T00:00:00.000Z', new Date('2026-01-01'))).toBe(false);
  });

  it('treats a null due date as not overdue', () => {
    expect(isOverdue(null)).toBe(false);
  });

  it('compares year/month pairs correctly', () => {
    expect(isSameYearMonth({ year: 2026, month: 7 }, { year: 2026, month: 7 })).toBe(true);
    expect(isSameYearMonth({ year: 2026, month: 7 }, { year: 2026, month: 8 })).toBe(false);
    expect(isSameYearMonth(null, { year: 2026, month: 7 })).toBe(false);
  });
});
