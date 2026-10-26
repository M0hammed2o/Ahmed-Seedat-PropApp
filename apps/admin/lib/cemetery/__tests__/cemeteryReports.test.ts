import { describe, expect, it } from 'vitest';
import {
  buildMonthlyReport,
  monthKeysEndingAt,
  statusAt,
  totals,
  type ReportEvent,
} from '@/lib/cemetery/reports';

const ev = (
  site_id: string,
  event_type: ReportEvent['event_type'],
  event_date: string,
): ReportEvent => ({
  site_id,
  event_type,
  event_date,
  created_at: `${event_date}T10:00:00Z`,
});

describe('cemetery monthly report', () => {
  it('lists the 12 months ending at a month, across a year boundary', () => {
    expect(monthKeysEndingAt('2026-10', 12)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
  });

  it('replays site status and occupancy at a date from the history', () => {
    const events = [
      ev('s1', 'reserved', '2026-01-12'),
      ev('s1', 'sold', '2026-02-09'),
      ev('s2', 'sold', '2026-01-05'),
      ev('s2', 'burial', '2026-01-09'),
      ev('s3', 'withdrawn', '2025-10-01'),
      ev('s4', 'sold', '2025-12-03'),
      ev('s4', 'sale_cancelled', '2026-03-20'),
    ];
    const ids = ['s1', 's2', 's3', 's4', 's5'];
    expect(statusAt(ids, events, '2026-01-31')).toEqual({
      available: 1,
      reserved: 1,
      sold: 2,
      unavailable: 1,
      occupied: 1,
    });
    expect(statusAt(ids, events, '2026-03-31')).toEqual({
      available: 2,
      reserved: 0,
      sold: 2,
      unavailable: 1,
      occupied: 1,
    });
  });

  it('counts sales by sale date, cancellations by cancellation date, money by payment date, and month-end balances', () => {
    const sales = [
      {
        id: 'a',
        site_id: 's1',
        purchaser_id: 'p',
        sale_number: 'GS-1',
        sale_date: '2026-02-09',
        price: 14500,
        status: 'active' as const,
        cancelled_on: null,
      },
      {
        id: 'b',
        site_id: 's4',
        purchaser_id: 'q',
        sale_number: 'GS-2',
        sale_date: '2025-12-03',
        price: 11500,
        status: 'cancelled' as const,
        cancelled_on: '2026-03-20',
      },
    ];
    const payments = [
      {
        id: '1',
        sale_id: 'a',
        receipt_number: 'GR-1',
        amount: 4350,
        paid_on: '2026-02-09',
        is_deposit: true,
      },
      {
        id: '2',
        sale_id: 'a',
        receipt_number: 'GR-2',
        amount: 1500,
        paid_on: '2026-03-09',
        is_deposit: false,
      },
      {
        id: '3',
        sale_id: 'b',
        receipt_number: 'GR-3',
        amount: 3000,
        paid_on: '2025-12-03',
        is_deposit: true,
      },
      {
        id: '4',
        sale_id: 'b',
        receipt_number: 'GR-4',
        amount: 1500,
        paid_on: '2026-01-03',
        is_deposit: false,
      },
    ];
    const rows = buildMonthlyReport({
      months: ['2025-12', '2026-01', '2026-02', '2026-03'],
      siteIds: ['s1', 's4'],
      sales,
      payments,
      burials: [{ id: 'x', site_id: 's1', burial_date: '2026-03-02' }],
      events: [
        ev('s4', 'sold', '2025-12-03'),
        ev('s1', 'reserved', '2026-01-12'),
        ev('s1', 'sold', '2026-02-09'),
        ev('s4', 'sale_cancelled', '2026-03-20'),
      ],
      today: '2026-10-26',
    });
    const by = Object.fromEntries(rows.map((r) => [r.month, r]));
    expect(by['2025-12']).toMatchObject({
      salesCount: 1,
      salesValue: 11500,
      depositsCollected: 3000,
      outstandingAtMonthEnd: 8500,
    });
    expect(by['2026-01']).toMatchObject({
      salesCount: 0,
      instalmentsCollected: 1500,
      reservationsMade: 1,
      outstandingAtMonthEnd: 7000,
    });
    expect(by['2026-02']).toMatchObject({
      salesCount: 1,
      salesValue: 14500,
      paymentsCollected: 4350,
      outstandingAtMonthEnd: 7000 + 10150,
    });
    // The cancellation removes its balance from month-end outstanding; money already received stays collected.
    expect(by['2026-03']).toMatchObject({
      cancellations: 1,
      cancelledValue: 11500,
      burials: 1,
      outstandingAtMonthEnd: 8650,
    });
    expect(by['2026-03']!.status).toEqual({
      available: 1,
      reserved: 0,
      sold: 1,
      unavailable: 0,
      occupied: 0,
    });
    expect(totals(rows)).toMatchObject({
      salesCount: 2,
      paymentsCollected: 10350,
      cancellations: 1,
    });
  });
});
