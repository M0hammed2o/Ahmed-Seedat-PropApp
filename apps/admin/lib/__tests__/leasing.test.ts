import { describe, expect, it } from 'vitest';
import type { RentSchedule } from '@propvault/types';
import { calculateOutstandingRentTotal } from '../leasing';

// V1 launch readiness pass (WORKLOG.md this date): pins the real bug found in
// (tenant)/my-payments/page.tsx -- the tenant portal's own outstanding-balance total previously
// excluded `invoiced` and `partial` rent schedules, both of which represent money genuinely still
// owed. Every status except `paid` must count.

describe('calculateOutstandingRentTotal', () => {
  it('sums pending schedules', () => {
    expect(calculateOutstandingRentTotal([{ status: 'pending', amount: 1000 }])).toBe(1000);
  });

  it('includes invoiced schedules -- the real bug this fix closes', () => {
    expect(calculateOutstandingRentTotal([{ status: 'invoiced', amount: 1000 }])).toBe(1000);
  });

  it('includes partial schedules -- the original audit finding', () => {
    expect(calculateOutstandingRentTotal([{ status: 'partial', amount: 1000 }])).toBe(1000);
  });

  it('includes overdue schedules', () => {
    expect(calculateOutstandingRentTotal([{ status: 'overdue', amount: 1000 }])).toBe(1000);
  });

  it('excludes paid schedules', () => {
    expect(calculateOutstandingRentTotal([{ status: 'paid', amount: 1000 }])).toBe(0);
  });

  it('sums a realistic mixed set correctly, excluding only paid', () => {
    const schedules: { status: RentSchedule['status']; amount: number }[] = [
      { status: 'paid', amount: 5000 },
      { status: 'invoiced', amount: 5000 },
      { status: 'partial', amount: 5000 },
      { status: 'overdue', amount: 5000 },
      { status: 'pending', amount: 5000 },
    ];
    expect(calculateOutstandingRentTotal(schedules)).toBe(20000);
  });

  it('returns 0 for an empty list', () => {
    expect(calculateOutstandingRentTotal([])).toBe(0);
  });

  it('coerces a string amount (as Supabase numeric columns are sometimes returned) to a number', () => {
    expect(
      calculateOutstandingRentTotal([
        { status: 'pending', amount: '1500.50' as unknown as number },
      ]),
    ).toBe(1500.5);
  });
});
