import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  earliestPeriodNeeded,
  loadPaidCentsByLeasePeriod,
  scheduleOutstanding,
  schedulePaid,
  summariseCollection,
  type ScheduleForCollection,
} from '../rentCollection';

const s = (
  lease_id: string,
  due_date: string,
  amount: number,
  status: string,
): ScheduleForCollection => ({ lease_id, due_date, amount, status });

describe('schedulePaid / scheduleOutstanding', () => {
  const paid = new Map([
    ['L1:2026-11-01', 400_000], // R4 000 of R10 000
    ['L2:2026-11-01', 1_500_000], // R15 000 against R12 000 -- overpaid
  ]);

  it('counts a paid schedule in full even with no invoice (pre-invoicing history)', () => {
    expect(schedulePaid(s('L9', '2025-01-01', 9000, 'paid'), new Map())).toBe(9000);
  });

  it('counts part-payments on an unsettled schedule and leaves the balance outstanding', () => {
    const row = s('L1', '2026-11-01', 10000, 'partial');
    expect(schedulePaid(row, paid)).toBe(4000);
    expect(scheduleOutstanding(row, paid)).toBe(6000);
  });

  it('never counts more than the schedule amount, nor a negative balance', () => {
    const row = s('L2', '2026-11-01', 12000, 'invoiced');
    expect(schedulePaid(row, paid)).toBe(12000);
    expect(scheduleOutstanding(row, paid)).toBe(0);
  });

  it('treats an invoiced schedule with no payment as wholly outstanding', () => {
    expect(scheduleOutstanding(s('L3', '2026-11-01', 8000, 'overdue'), paid)).toBe(8000);
  });

  it('has nothing outstanding on pending (not yet invoiced) or paid schedules', () => {
    expect(scheduleOutstanding(s('L3', '2026-12-01', 8000, 'pending'), paid)).toBe(0);
    expect(scheduleOutstanding(s('L3', '2026-10-01', 8000, 'paid'), paid)).toBe(0);
  });
});

describe('summariseCollection', () => {
  it('reconciles: expected = fully paid + part-payments + outstanding (+ not yet invoiced)', () => {
    const paid = new Map([['B:2026-11-01', 515_000]]);
    const rows = [
      s('A', '2026-11-01', 12000, 'paid'),
      s('B', '2026-11-01', 10300.5, 'partial'),
      s('C', '2026-11-01', 9000, 'invoiced'),
    ];
    const t = summariseCollection(rows, paid);
    expect(t).toEqual({
      expected: 31300.5,
      collected: 17150,
      fullyPaid: 12000,
      partPaid: 5150,
      outstanding: 14150.5,
    });
    expect(t.fullyPaid + t.partPaid + t.outstanding).toBe(t.expected);
  });
});

describe('earliestPeriodNeeded', () => {
  it('reaches back to the oldest unpaid schedule, but not to old paid ones', () => {
    const rows = [
      s('A', '2024-06-01', 1, 'paid'),
      s('B', '2026-09-01', 1, 'overdue'),
      s('C', '2026-11-01', 1, 'invoiced'),
    ];
    expect(earliestPeriodNeeded(rows, '2026-11-01')).toBe('2026-09-01');
    expect(earliestPeriodNeeded(rows.slice(0, 1), '2026-11-01')).toBe('2026-11-01');
  });
});

// Minimal PostgREST-like client for `invoices`: applies neq/gte/eq, orders by id, caps at 1000.
function fakeSupabase(invoices: Record<string, unknown>[]) {
  const filters: { op: string; col: string; val: unknown }[] = [];
  const builder = {
    select: () => builder,
    neq: (col: string, val: unknown) => (filters.push({ op: 'neq', col, val }), builder),
    gte: (col: string, val: unknown) => (filters.push({ op: 'gte', col, val }), builder),
    eq: (col: string, val: unknown) => (filters.push({ op: 'eq', col, val }), builder),
    order: () => builder,
    range: (from: number, to: number) => {
      const rows = invoices
        .filter((r) =>
          filters.every((f) =>
            f.op === 'neq'
              ? r[f.col] !== f.val
              : f.op === 'eq'
                ? r[f.col] === f.val
                : String(r[f.col]) >= String(f.val),
          ),
        )
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return Promise.resolve({
        data: rows.slice(from, Math.min(to + 1, from + 1000)),
        error: null,
      });
    },
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

describe('loadPaidCentsByLeasePeriod', () => {
  it('sums non-reversed payments of non-void rent invoices, across more than 1000 invoices', async () => {
    const invoices: Record<string, unknown>[] = Array.from({ length: 1500 }, (_, i) => ({
      id: `inv-${String(i).padStart(5, '0')}`,
      org_id: 'org-a',
      lease_id: `L${i}`,
      period: '2026-11-01',
      source: 'rent_schedule',
      voided_at: null,
      invoice_payments: [{ amount: 100.1, reversed_at: null }],
    }));
    invoices.push(
      {
        id: 'inv-void',
        org_id: 'org-a',
        lease_id: 'LV',
        period: '2026-11-01',
        source: 'rent_schedule',
        voided_at: '2026-11-02',
        invoice_payments: [{ amount: 500, reversed_at: null }],
      },
      {
        id: 'inv-rev',
        org_id: 'org-a',
        lease_id: 'LR',
        period: '2026-11-01',
        source: 'rent_schedule',
        voided_at: null,
        invoice_payments: [
          { amount: 500, reversed_at: '2026-11-02' },
          { amount: 200, reversed_at: null },
        ],
      },
      {
        id: 'inv-manual',
        org_id: 'org-a',
        lease_id: 'LM',
        period: '2026-11-01',
        source: 'manual',
        voided_at: null,
        invoice_payments: [{ amount: 999, reversed_at: null }],
      },
      {
        id: 'inv-other-org',
        org_id: 'org-b',
        lease_id: 'LO',
        period: '2026-11-01',
        source: 'rent_schedule',
        voided_at: null,
        invoice_payments: [{ amount: 1, reversed_at: null }],
      },
      {
        id: 'inv-old',
        org_id: 'org-a',
        lease_id: 'L0',
        period: '2026-08-01',
        source: 'rent_schedule',
        voided_at: null,
        invoice_payments: [{ amount: 1, reversed_at: null }],
      },
    );
    const paid = await loadPaidCentsByLeasePeriod(fakeSupabase(invoices), {
      fromPeriod: '2026-09-01',
      orgId: 'org-a',
    });
    expect(paid.get('L1499:2026-11-01')).toBe(10010); // a row past the first 1000
    expect(paid.has('LV:2026-11-01')).toBe(false); // void invoice
    expect(paid.get('LR:2026-11-01')).toBe(20000); // reversed payment excluded
    expect(paid.has('LM:2026-11-01')).toBe(false); // manual (non-rent) invoice
    expect(paid.has('LO:2026-11-01')).toBe(false); // other organisation
    expect(paid.has('L0:2026-08-01')).toBe(false); // before fromPeriod
    expect(paid.size).toBe(1501);
  });
});
