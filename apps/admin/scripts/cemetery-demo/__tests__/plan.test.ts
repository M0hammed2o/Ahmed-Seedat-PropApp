import { describe, expect, it } from 'vitest';
import {
  HISTORY_END,
  HISTORY_START,
  PROPERTIES,
  TICKETS,
  cemeteryPlan,
  dueDates,
  expenses,
  rentPayments,
  type CemAct,
} from '../plan';

// The demo year (scripts/cemetery-demo/plan.ts) must be internally consistent before it is ever written anywhere:
// chronological, never after "today", no double sale, no overpayment, and the money reconciles.

const TODAY = '2026-10-26';

describe('cemetery demo year', () => {
  const { acts } = cemeteryPlan(TODAY);

  it('is sorted and never dated after today', () => {
    expect(acts.length).toBeGreaterThan(150);
    for (let i = 1; i < acts.length; i++) expect(acts[i]!.date >= acts[i - 1]!.date).toBe(true);
    expect(acts.every((a) => a.date <= TODAY)).toBe(true);
  });

  it('replays to a consistent register: no double sale, no sale of a reserved-for-other or withdrawn site, burials only on sold sites, payments never above the price', () => {
    type Site = {
      status: 'available' | 'reserved' | 'sold' | 'unavailable';
      reservedFor?: string;
      burials: number;
    };
    const sites = new Map<string, Site>();
    const site = (s: string) => {
      if (!sites.has(s)) sites.set(s, { status: 'available', burials: 0 });
      return sites.get(s)!;
    };
    const sales = new Map<
      string,
      { site: string; price: number; paid: number; date: string; active: boolean; lastPay: string }
    >();
    const doubles = new Set(['A-021', 'A-022', 'A-023', 'A-024']);
    for (const a of acts as CemAct[]) {
      if (a.k === 'withdraw') {
        expect(site(a.site).status, `${a.site} withdrawn`).toBe('available');
        site(a.site).status = 'unavailable';
      } else if (a.k === 'return') {
        expect(site(a.site).status).toBe('unavailable');
        site(a.site).status = 'available';
      } else if (a.k === 'reserve') {
        expect(site(a.site).status, `${a.site} reserve on ${a.date}`).toBe('available');
        Object.assign(site(a.site), { status: 'reserved', reservedFor: a.holder });
      } else if (a.k === 'release') {
        expect(site(a.site).status).toBe('reserved');
        site(a.site).status = 'available';
      } else if (a.k === 'sale') {
        const s = site(a.site);
        expect(
          s.status === 'available' || (s.status === 'reserved' && s.reservedFor === a.holder),
          `${a.site} sold on ${a.date} while ${s.status}`,
        ).toBe(true);
        expect(a.deposit).toBeGreaterThan(0);
        expect(a.deposit).toBeLessThanOrEqual(a.price);
        s.status = 'sold';
        expect(sales.has(a.key), `duplicate sale ${a.key}`).toBe(false);
        sales.set(a.key, {
          site: a.site,
          price: a.price,
          paid: a.deposit,
          date: a.date,
          active: true,
          lastPay: a.date,
        });
      } else if (a.k === 'pay') {
        const s = sales.get(a.key)!;
        expect(s, `payment for unknown sale ${a.key}`).toBeTruthy();
        expect(s.active).toBe(true);
        expect(a.date >= s.date).toBe(true);
        s.paid = Math.round((s.paid + a.amount) * 100) / 100;
        s.lastPay = a.date;
        expect(s.paid, `${a.key} overpaid`).toBeLessThanOrEqual(s.price);
      } else if (a.k === 'cancel') {
        const s = sales.get(a.key)!;
        expect(a.date >= s.lastPay).toBe(true);
        expect(site(s.site).burials).toBe(0);
        s.active = false;
        site(s.site).status = 'available';
      } else if (a.k === 'burial') {
        const s = site(a.site);
        expect(s.status, `${a.site} burial on ${a.date}`).toBe('sold');
        s.burials += 1;
        expect(s.burials).toBeLessThanOrEqual(doubles.has(a.site) ? 2 : 1);
        expect(a.dod <= a.date).toBe(true);
      }
    }
    const statuses = [...sites.values()];
    // Sections A, B, C hold 120 sites; untouched sites are available.
    const touched = sites.size;
    const count = (st: Site['status']) => statuses.filter((s) => s.status === st).length;
    expect(count('reserved')).toBe(10);
    expect(count('unavailable')).toBe(5);
    expect(count('sold')).toBeGreaterThan(60);
    expect(120 - touched + count('available')).toBeGreaterThan(20);
    const yearSales = [...sales.values()].filter((s) => s.date >= HISTORY_START);
    expect(yearSales.length).toBeGreaterThanOrEqual(40);
    expect(yearSales.filter((s) => !s.active)).toHaveLength(3); // three cancellations
    const owing = [...sales.values()].filter((s) => s.active && s.paid < s.price);
    expect(owing.length).toBeGreaterThanOrEqual(8); // live payment plans and some arrears
  });

  it('has sales and payments in every month of the year', () => {
    for (let m = 0; m < 12; m++) {
      const month = new Date(Date.UTC(2025, 10 + m, 1)).toISOString().slice(0, 7);
      expect(
        acts.some((a) => a.k === 'sale' && a.date.startsWith(month)),
        `sales in ${month}`,
      ).toBe(true);
      expect(
        acts.some((a) => (a.k === 'pay' || a.k === 'sale') && a.date.startsWith(month)),
        `payments in ${month}`,
      ).toBe(true);
    }
  });

  it('includes the reservation → deposit → instalments → settled story', () => {
    const moodley = acts.filter(
      (a) => ('site' in a && a.site === 'B-014') || ('key' in a && a.key.startsWith('B-014@')),
    );
    expect(moodley.map((a) => `${a.k}:${a.date}`)).toEqual([
      'reserve:2026-01-12',
      'sale:2026-02-09',
      'pay:2026-03-09',
      'pay:2026-04-09',
      'pay:2026-05-09',
      'pay:2026-06-09',
      'pay:2026-07-09',
      'pay:2026-08-14',
    ]);
  });
});

describe('property demo year', () => {
  it('rent is due only inside the window and never after today, and payments never exceed rent', () => {
    for (const p of PROPERTIES) {
      for (const u of p.units) {
        for (let i = 0; i < u.tenancies.length; i++) {
          const t = u.tenancies[i]!;
          if (i > 0)
            expect(t.start > u.tenancies[i - 1]!.end, `${u.label} leases overlap`).toBe(true);
          for (const d of dueDates(t, TODAY)) {
            expect(d >= HISTORY_START && d <= HISTORY_END && d <= TODAY).toBe(true);
            const paid = rentPayments(u.label, t, TODAY)
              .filter((x) => x.dueDate === d)
              .reduce((a, x) => a + x.amount, 0);
            expect(paid).toBeLessThanOrEqual(t.rent);
          }
          for (const pay of rentPayments(u.label, t, TODAY)) expect(pay.paidOn <= TODAY).toBe(true);
        }
      }
    }
  });

  it('has vacancies, renewals, a tenant change, arrears and a partial payment', () => {
    const units = PROPERTIES.flatMap((p) => p.units);
    expect(units).toHaveLength(18);
    expect(
      units.filter(
        (u) => u.tenancies.length === 2 && u.tenancies[0]!.tenant === u.tenancies[1]!.tenant,
      ).length,
    ).toBeGreaterThanOrEqual(3); // renewals
    expect(
      units.some(
        (u) => u.tenancies.length === 2 && u.tenancies[0]!.tenant !== u.tenancies[1]!.tenant,
      ),
    ).toBe(true); // tenant change
    expect(units.filter((u) => u.tenancies.every((t) => t.final !== 'active')).length).toBe(3); // vacant now
    const unpaid = units.flatMap((u) =>
      u.tenancies.flatMap((t) => Object.values(t.exceptions ?? {}).filter((x) => x.length === 0)),
    );
    expect(unpaid.length).toBeGreaterThanOrEqual(3);
  });

  it('expenses and tickets are dated inside the window and not after today', () => {
    const all = expenses(TODAY);
    expect(all.length).toBeGreaterThan(140);
    expect(all.every((e) => e.date >= HISTORY_START && e.date <= TODAY)).toBe(true);
    expect(new Set(all.map((e) => e.reference)).size).toBe(all.length);
    expect(TICKETS.every((t) => t.opened <= TODAY && (!t.resolved || t.resolved <= TODAY))).toBe(
      true,
    );
  });
});
