import { describe, expect, it } from 'vitest';
import { resolvePeriodRange } from '@/lib/dashboardKpis';

// Period filters added with the demo year (2026-10-26): last 12 months, a chosen month and a chosen calendar year.
describe('resolvePeriodRange — 12 months, month and year', () => {
  const now = new Date(2026, 9, 26); // 26 October 2026, local time

  it('last_12_months covers the current month and the 11 before it', () => {
    const r = resolvePeriodRange('last_12_months', {}, now);
    expect(r.startIso).toBe('2025-11-01');
    expect(r.endIso).toBe('2026-10-31');
    expect(r.label).toBe('the last 12 months (November 2025 – October 2026)');
  });

  it('a whole calendar month reads as the month', () => {
    expect(resolvePeriodRange('custom', { from: '2026-03-01', to: '2026-03-31' }, now).label).toBe(
      'March 2026',
    );
    expect(resolvePeriodRange('custom', { from: '2026-02-01', to: '2026-02-28' }, now).label).toBe(
      'February 2026',
    );
  });

  it('a whole calendar year reads as the year; other ranges keep their bounds', () => {
    expect(resolvePeriodRange('custom', { from: '2026-01-01', to: '2026-12-31' }, now).label).toBe(
      '2026',
    );
    expect(resolvePeriodRange('custom', { from: '2026-03-01', to: '2026-05-15' }, now).label).toBe(
      '2026-03-01 to 2026-05-15',
    );
  });
});
