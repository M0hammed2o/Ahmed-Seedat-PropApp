import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { INVOICE_PAGE_SIZE, LEASE_ID_CHUNK_SIZE, loadInvoicesWithBalances } from '../invoicing';

// loadInvoicesWithBalances() against a scripted Supabase client (2026-09-14 production defect: every
// invoice of a large organisation reported Paid R0 because the payments read failed with HTTP 414 and
// the failure was treated as "no payments"). Complements invoiceBalances.integration.test.ts, which
// proves the same thing against real PostgREST at 444 invoices.

type Call = [method: string, ...args: unknown[]];
interface Read {
  table: string;
  calls: Call[];
}
type Responder = (read: Read) => { data: unknown[] | null; error: { message: string } | null };

function scriptedClient(respond: Responder) {
  const reads: Read[] = [];
  const client = {
    from(table: string) {
      const read: Read = { table, calls: [] };
      reads.push(read);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'order', 'eq', 'in', 'is', 'range']) {
        builder[method] = (...args: unknown[]) => {
          read.calls.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => respond(read))
          .then(resolve, reject);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, reads };
}

function pick<T extends { id: string }>(rows: T[], id: string): T {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`invoice ${id} missing from the result`);
  return row;
}

const arg = (read: Read, method: string) => read.calls.find(([m]) => m === method)?.slice(1);

function invoice(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    invoice_number: `INV-${id}`,
    tenant_id: 't1',
    lease_id: 'lease-1',
    period: '2026-09-01',
    issued_at: '2026-09-01T08:00:00Z',
    amount: '9500.00',
    status: 'issued',
    emailed_at: null,
    voided_at: null,
    source: 'rent_schedule',
    description: null,
    leases: null,
    tenants: null,
    invoice_payments: [],
    ...overrides,
  };
}

/** Serves `rows` page by page for the invoices read, and `schedules` for rent_schedules. */
function paged(rows: unknown[], schedules: unknown[] = []): Responder {
  return (read) => {
    const [from, to] = (arg(read, 'range') ?? [0, INVOICE_PAGE_SIZE - 1]) as [number, number];
    if (read.table === 'invoices') return { data: rows.slice(from, to + 1), error: null };
    if (read.table === 'rent_schedules') {
      const ids = new Set(arg(read, 'in')?.[1] as string[]);
      return {
        data: schedules
          .filter((s) => ids.has((s as { lease_id: string }).lease_id))
          .slice(from, to + 1),
        error: null,
      };
    }
    return { data: null, error: { message: `unexpected table ${read.table}` } };
  };
}

describe('loadInvoicesWithBalances -- paid and balance', () => {
  it('fully paid (the INV-001972 case), partially paid, unpaid, and a reversed payment excluded', async () => {
    const { client } = scriptedClient(
      paged([
        invoice('full', { invoice_payments: [{ amount: '9500.00', reversed_at: null }] }),
        invoice('partial', {
          amount: '10800.00',
          invoice_payments: [{ amount: '6000.00', reversed_at: null }],
        }),
        invoice('unpaid', { amount: '7950.00' }),
        invoice('reversed', {
          amount: '5000.00',
          invoice_payments: [
            { amount: '5000.00', reversed_at: '2026-09-05T10:00:00Z' },
            { amount: '1000.00', reversed_at: null },
          ],
        }),
      ]),
    );
    const result = await loadInvoicesWithBalances(client);
    const byId = {
      full: pick(result, 'full'),
      partial: pick(result, 'partial'),
      unpaid: pick(result, 'unpaid'),
      reversed: pick(result, 'reversed'),
    };

    expect([byId.full.amount, byId.full.paid, byId.full.balance, byId.full.displayStatus]).toEqual([
      9500,
      9500,
      0,
      'Paid',
    ]);
    expect([byId.partial.paid, byId.partial.balance, byId.partial.displayStatus]).toEqual([
      6000,
      4800,
      'Partially paid',
    ]);
    expect([byId.unpaid.paid, byId.unpaid.balance, byId.unpaid.displayStatus]).toEqual([
      0,
      7950,
      'Issued',
    ]);
    expect([byId.reversed.paid, byId.reversed.balance]).toEqual([1000, 4000]);
  });

  it('sums cent amounts exactly, so R100.10 + R200.20 settles a R300.30 invoice', async () => {
    const { client } = scriptedClient(
      paged([
        invoice('cents', {
          amount: '300.30',
          invoice_payments: [
            { amount: '100.10', reversed_at: null },
            { amount: '200.20', reversed_at: null },
          ],
        }),
      ]),
    );
    const only = pick(await loadInvoicesWithBalances(client), 'cents');
    expect([only.paid, only.balance, only.displayStatus]).toEqual([300.3, 0, 'Paid']);
  });

  it('keeps a void invoice at balance 0 and Void, whatever was paid', async () => {
    const { client } = scriptedClient(
      paged([
        invoice('void', {
          voided_at: '2026-09-02T00:00:00Z',
          invoice_payments: [{ amount: '100.00', reversed_at: null }],
        }),
      ]),
    );
    const only = pick(await loadInvoicesWithBalances(client), 'void');
    expect([only.balance, only.displayStatus]).toEqual([0, 'Void']);
  });
});

describe('loadInvoicesWithBalances -- scale', () => {
  it('reads every page of a 2,350-invoice organisation and computes each invoice from its own payments', async () => {
    const rows = Array.from({ length: 2350 }, (_, n) =>
      invoice(`inv-${n}`, {
        amount: '1000.00',
        invoice_payments: n % 7 === 0 ? [] : [{ amount: '1000.00', reversed_at: null }],
      }),
    );
    const { client, reads } = scriptedClient(paged(rows));
    const result = await loadInvoicesWithBalances(client);

    expect(result).toHaveLength(2350);
    expect(reads.filter((r) => r.table === 'invoices').map((r) => arg(r, 'range'))).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    for (const inv of result) {
      const unpaid = Number(inv.id.slice(4)) % 7 === 0;
      expect([inv.paid, inv.balance]).toEqual(unpaid ? [0, 1000] : [1000, 0]);
    }
  });

  it('never sends the invoice ids in a URL: no invoice_id=in.(...) read exists any more', async () => {
    const rows = Array.from({ length: 450 }, (_, n) => invoice(`inv-${n}`));
    const { client, reads } = scriptedClient(paged(rows));
    await loadInvoicesWithBalances(client);
    expect(reads.some((r) => r.table === 'invoice_payments')).toBe(false);
    expect(
      reads.flatMap((r) => r.calls).some(([m, column]) => m === 'in' && column === 'invoice_id'),
    ).toBe(false);
  });

  it('looks rent schedules up in bounded lease-id chunks, and still resolves Overdue from the schedule', async () => {
    const rows = Array.from({ length: 250 }, (_, n) =>
      invoice(`inv-${n}`, { lease_id: `lease-${n}` }),
    );
    const schedules = Array.from({ length: 250 }, (_, n) => ({
      id: `s-${n}`,
      lease_id: `lease-${n}`,
      due_date: '2026-09-01',
      status: n === 249 ? 'overdue' : 'invoiced',
    }));
    const { client, reads } = scriptedClient(paged(rows, schedules));
    const result = await loadInvoicesWithBalances(client);

    const chunks = reads
      .filter((r) => r.table === 'rent_schedules')
      .map((r) => (arg(r, 'in')?.[1] as string[]).length);
    expect(chunks).toEqual([100, 100, 50]);
    expect(Math.max(...chunks)).toBeLessThanOrEqual(LEASE_ID_CHUNK_SIZE);
    expect(pick(result, 'inv-249').displayStatus).toBe('Overdue');
    expect(pick(result, 'inv-0').displayStatus).toBe('Issued');
  });
});

describe('loadInvoicesWithBalances -- failures never become Paid R0', () => {
  it('throws when the invoice read (which carries the payments) fails', async () => {
    const { client } = scriptedClient(() => ({ data: null, error: { message: 'URI too long' } }));
    await expect(loadInvoicesWithBalances(client)).rejects.toThrow(
      /Failed to load invoices: URI too long/,
    );
  });

  it('throws when a later page fails, rather than returning the pages it did get', async () => {
    const rows = Array.from({ length: 1500 }, (_, n) =>
      invoice(`inv-${n}`, { invoice_payments: [{ amount: '9500.00', reversed_at: null }] }),
    );
    const serve = paged(rows);
    const { client } = scriptedClient((read) =>
      read.table === 'invoices' && arg(read, 'range')?.[0] === 1000
        ? { data: null, error: { message: 'timeout' } }
        : serve(read),
    );
    await expect(loadInvoicesWithBalances(client)).rejects.toThrow(
      /Failed to load invoices: timeout/,
    );
  });

  it('throws when the rent schedule read fails', async () => {
    const serve = paged([invoice('a')]);
    const { client } = scriptedClient((read) =>
      read.table === 'rent_schedules'
        ? { data: null, error: { message: 'permission denied' } }
        : serve(read),
    );
    await expect(loadInvoicesWithBalances(client)).rejects.toThrow(
      /Failed to load rent schedules: permission denied/,
    );
  });
});

describe('loadInvoicesWithBalances -- one invoice', () => {
  it('filters to the requested invoice id and computes it exactly as the list does', async () => {
    const rows = [
      invoice('target', { invoice_payments: [{ amount: '9500.00', reversed_at: null }] }),
    ];
    const { client, reads } = scriptedClient(paged(rows));
    const only = pick(await loadInvoicesWithBalances(client, { invoiceId: 'target' }), 'target');

    const invoiceRead = reads.find((r) => r.table === 'invoices')!;
    expect(invoiceRead.calls).toContainEqual(['eq', 'id', 'target']);
    expect([only.paid, only.balance]).toEqual([9500, 0]);
  });
});
