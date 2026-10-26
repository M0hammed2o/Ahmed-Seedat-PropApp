// Cemetery monthly reporting (migration 184). Pure functions over the cemetery read model so the reports page, the
// dashboard and unit tests compute the same figures. Dates are business dates (YYYY-MM-DD, South Africa).

import type { GraveSaleStatus } from '@/lib/cemetery/terms';

export interface ReportSale {
  id: string;
  site_id: string;
  purchaser_id: string;
  sale_number: string;
  sale_date: string;
  price: number;
  status: 'active' | 'cancelled';
  /** Business date of the cancellation (null while active). */
  cancelled_on: string | null;
}

export interface ReportPayment {
  id: string;
  sale_id: string;
  receipt_number: string;
  amount: number;
  paid_on: string;
  is_deposit: boolean;
}

export interface ReportBurial {
  id: string;
  site_id: string;
  burial_date: string;
}

export interface ReportEvent {
  site_id: string;
  event_type:
    | 'reserved'
    | 'reservation_released'
    | 'sold'
    | 'sale_cancelled'
    | 'withdrawn'
    | 'returned_to_sale'
    | 'burial';
  event_date: string;
  created_at: string;
}

export interface MonthRow {
  month: string; // YYYY-MM
  label: string;
  salesCount: number;
  salesValue: number;
  cancellations: number;
  cancelledValue: number;
  depositsCollected: number;
  instalmentsCollected: number;
  paymentsCollected: number;
  reservationsMade: number;
  reservationsReleased: number;
  burials: number;
  outstandingAtMonthEnd: number;
  status: Record<GraveSaleStatus, number> & { occupied: number };
}

const round = (n: number) => Math.round(n * 100) / 100;

export function monthKeysEndingAt(endMonth: string, count: number): string[] {
  const [y, m] = endMonth.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function monthLabel(month: string, style: 'short' | 'long' = 'short'): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-ZA', {
    month: style,
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Site sale status and occupancy at the end of a day, replayed from the site history. */
export function statusAt(
  siteIds: string[],
  events: ReportEvent[],
  asOf: string,
): Record<GraveSaleStatus, number> & { occupied: number } {
  const ordered = events
    .filter((e) => e.event_date <= asOf)
    .sort((a, b) =>
      a.event_date === b.event_date
        ? a.created_at.localeCompare(b.created_at)
        : a.event_date.localeCompare(b.event_date),
    );
  const state = new Map<string, GraveSaleStatus>();
  const occupied = new Set<string>();
  for (const e of ordered) {
    if (e.event_type === 'burial') occupied.add(e.site_id);
    else if (e.event_type === 'reserved') state.set(e.site_id, 'reserved');
    else if (e.event_type === 'sold') state.set(e.site_id, 'sold');
    else if (e.event_type === 'withdrawn') state.set(e.site_id, 'unavailable');
    else state.set(e.site_id, 'available'); // released, cancelled, returned to sale
  }
  const out = { available: 0, reserved: 0, sold: 0, unavailable: 0, occupied: occupied.size };
  for (const id of siteIds) out[state.get(id) ?? 'available'] += 1;
  return out;
}

export function buildMonthlyReport(input: {
  months: string[];
  siteIds: string[];
  sales: ReportSale[];
  payments: ReportPayment[];
  burials: ReportBurial[];
  events: ReportEvent[];
  /** Cap for the current, unfinished month (month-end figures are "as of today"). */
  today: string;
}): MonthRow[] {
  const { months, siteIds, sales, payments, burials, events, today } = input;
  return months.map((month) => {
    const end = monthEnd(month) < today ? monthEnd(month) : today;
    const inMonth = (d: string | null) => Boolean(d) && d!.slice(0, 7) === month;
    const sold = sales.filter((s) => inMonth(s.sale_date));
    const cancelled = sales.filter((s) => inMonth(s.cancelled_on));
    const paid = payments.filter((p) => inMonth(p.paid_on));
    const outstanding = sales
      .filter(
        (s) => s.sale_date <= end && (s.status === 'active' || (s.cancelled_on ?? '9999') > end),
      )
      .reduce((sum, s) => {
        const paidToDate = payments
          .filter((p) => p.sale_id === s.id && p.paid_on <= end)
          .reduce((a, p) => a + p.amount, 0);
        return sum + Math.max(0, s.price - paidToDate);
      }, 0);
    return {
      month,
      label: monthLabel(month),
      salesCount: sold.length,
      salesValue: round(sold.reduce((a, s) => a + s.price, 0)),
      cancellations: cancelled.length,
      cancelledValue: round(cancelled.reduce((a, s) => a + s.price, 0)),
      depositsCollected: round(paid.filter((p) => p.is_deposit).reduce((a, p) => a + p.amount, 0)),
      instalmentsCollected: round(
        paid.filter((p) => !p.is_deposit).reduce((a, p) => a + p.amount, 0),
      ),
      paymentsCollected: round(paid.reduce((a, p) => a + p.amount, 0)),
      reservationsMade: events.filter((e) => e.event_type === 'reserved' && inMonth(e.event_date))
        .length,
      reservationsReleased: events.filter(
        (e) => e.event_type === 'reservation_released' && inMonth(e.event_date),
      ).length,
      burials: burials.filter((b) => inMonth(b.burial_date)).length,
      outstandingAtMonthEnd: round(outstanding),
      status: statusAt(siteIds, events, end),
    };
  });
}

export function totals(rows: MonthRow[]) {
  const sum = (k: keyof MonthRow) => round(rows.reduce((a, r) => a + (r[k] as number), 0));
  return {
    salesCount: sum('salesCount'),
    salesValue: sum('salesValue'),
    cancellations: sum('cancellations'),
    cancelledValue: sum('cancelledValue'),
    depositsCollected: sum('depositsCollected'),
    instalmentsCollected: sum('instalmentsCollected'),
    paymentsCollected: sum('paymentsCollected'),
    reservationsMade: sum('reservationsMade'),
    reservationsReleased: sum('reservationsReleased'),
    burials: sum('burials'),
  };
}
